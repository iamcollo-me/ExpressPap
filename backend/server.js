import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import axios from 'axios';
import { Buffer } from 'buffer';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// Middleware Configuration
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// MongoDB Connection
const connectToDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4 // Force IPv4
    });
    console.log("✅ MongoDB connection established");
  } catch (error) {
    console.error("🔴 Critical MongoDB connection failure:", error);
    process.exit(1);
  }
};

// Database Models
const vehicleSchema = new mongoose.Schema({
  licensePlate: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  ownerName: String,
  carType: String,
  brand: String,
  color: String,
  registrationDate: {
    type: Date,
    default: Date.now,
  },
  contact: String,
});

const Vehicle = mongoose.model('Vehicle', vehicleSchema);

const transactionSchema = new mongoose.Schema({
  licensePlate: {
    type: String,
    required: true,
  },
  phoneNumber: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    default: 1,
  },
  status: {
    type: String,
    enum: ['pending', 'success', 'failed'],
    default: 'pending',
  },
  mpesaReceiptNumber: String,
  checkoutRequestID: String,
  merchantRequestID: String,
  transactionDate: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

const Transaction = mongoose.model('Transaction', transactionSchema);

// M-Pesa Token Handling
let mpesaAccessToken = null;
let tokenExpiryTime = null;

async function getMpesaAccessToken() {
  try {
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
      headers: { Authorization: `Basic ${auth}` },
    });

    mpesaAccessToken = response.data.access_token;
    tokenExpiryTime = Date.now() + 55 * 60 * 1000;
    console.log("🔑 M-Pesa access token refreshed");
  } catch (error) {
    console.error("🔴 Error fetching access token:", error.message);
    throw error;
  }
}

// M-Pesa Payment Initiation
async function initiateMpesaPayment(phone, amount = 1) {
  try {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[-T:]/g, '');
    const password = Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');

    // Convert phone number to 254 format
    const phoneString = phone.toString().trim();
    let formattedPhone;

    if (phoneString.startsWith("0")) {
      formattedPhone = `254${phoneString.slice(1)}`; // Convert 07... to 2547...
    } else if (phoneString.startsWith("+254")) {
      formattedPhone = phoneString.slice(1); // Remove the + from +254...
    } else if (phoneString.startsWith("254")) {
      formattedPhone = phoneString; // Already in 254 format
    } else if (phoneString.match(/^\d{9}$/)) {
      // Handle numbers like 790802553 (missing leading 0)
      formattedPhone = `254${phoneString}`; // Assume it's a local number missing the 0
    } else {
      throw new Error(`Invalid phone number format: ${phoneString}. Must start with 0, +254, or 254, or be 9 digits.`);
    }

    // Validate the formatted phone number
    if (formattedPhone.length !== 12 || !formattedPhone.match(/^254\d{9}$/)) {
      throw new Error(`Invalid phone number: ${formattedPhone}. Must be 12 digits starting with 254.`);
    }

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: amount,
        PartyA: formattedPhone,
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: formattedPhone,
        CallBackURL: process.env.MPESA_CALLBACK_URL,
        AccountReference: 'TollPayment',
        TransactionDesc: 'Toll Fee Payment',
      },
      {
        headers: { Authorization: `Bearer ${mpesaAccessToken}` },
      }
    );

    return response.data;
  } catch (error) {
    console.error("🔴 M-Pesa payment initiation error:", error.response?.data || error.message);
    throw error;
  }
}

// Schedule token refresh
setInterval(async () => {
  if (!mpesaAccessToken || Date.now() >= tokenExpiryTime) {
    await getMpesaAccessToken();
  }
}, 55 * 60 * 1000);

// Initial token fetch
getMpesaAccessToken();

// Routes
app.get('/', (req, res) => res.send("API is running..."));

// Vehicle Registration Endpoint
app.post('/register', async (req, res) => {
  try {
    const vehicle = new Vehicle(req.body);
    await vehicle.save();
    res.status(201).send({ message: "✔️ Successful Registration" });
  } catch (error) {
    res.status(500).send({ message: "❌ Error registering vehicle!", error });
  }
});

// Verify and Payment Endpoint (FIXED - single implementation)
app.post('/verify', async (req, res) => {
  try {
    // 1. Validate and clean input
    if (!req.body.licensePlate || typeof req.body.licensePlate !== 'string') {
      return res.status(400).json({ error: "Valid license plate required" });
    }

    // 2. Simply convert to uppercase and trim
    const licensePlate = req.body.licensePlate.toUpperCase().trim();

    // 3. Direct database query
    const vehicle = await Vehicle.findOne({ licensePlate }).lean();

    if (!vehicle) {
      return res.status(404).json({ 
        registered: false,
        searchedPlate: licensePlate 
      });
    }

    // 5. Proceed with payment
    const paymentResponse = await initiateMpesaPayment(vehicle.contact);
    const transaction = await Transaction.create({
      licensePlate: vehicle.licensePlate,
      phoneNumber: vehicle.contact,
      amount: 1,
      status: 'pending',
      checkoutRequestID: paymentResponse.CheckoutRequestID,
      merchantRequestID: paymentResponse.MerchantRequestID,
    });

    return res.json({
      registered: true,
      vehicle,
      transactionId: transaction._id
    });

  } catch (error) {
    console.error('Verify error:', error);
    return res.status(500).json({ 
      error: "Processing error",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// M-Pesa Callback Endpoint
app.post('/mpesa/callback', async (req, res) => {
  try {
    const { Body } = req.body;
    const { stkCallback } = Body;

    const transaction = await Transaction.findOne({
      checkoutRequestID: stkCallback.CheckoutRequestID,
      status: 'pending',
    }).sort({ createdAt: -1 });

    if (!transaction) {
      console.log("Transaction not found for CheckoutRequestID:", stkCallback.CheckoutRequestID);
      return res.status(404).send({ message: "Transaction not found" });
    }

    if (stkCallback.ResultCode === 0) {
      const metadata = stkCallback.CallbackMetadata.Item;
      const mpesaReceiptNumber = metadata.find(item => item.Name === "MpesaReceiptNumber")?.Value;

      transaction.status = 'success';
      transaction.mpesaReceiptNumber = mpesaReceiptNumber;
    } else {
      transaction.status = 'failed';
    }

    await transaction.save();
    console.log(`Transaction ${transaction._id} updated:`, {
      status: transaction.status,
      mpesaReceiptNumber: transaction.mpesaReceiptNumber,
      updatedAt: transaction.updatedAt,
    });

    res.status(200).send({
      status: "success",
      message: "Callback processed successfully",
    });
  } catch (error) {
    console.error("🔴 M-Pesa callback error:", error);
    res.status(500).send({
      status: "error",
      message: error.message,
    });
  }
});

// Transaction Status Check Endpoint
app.get('/transaction-status/:id', async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).send({
        status: 'error',
        message: "Transaction not found",
      });
    }

    res.status(200).send({
      status: transaction.status,
      transactionId: transaction._id,
      mpesaReceiptNumber: transaction.mpesaReceiptNumber,
      updatedAt: transaction.updatedAt,
    });
  } catch (error) {
    console.error("🔴 Transaction status error:", error);
    res.status(500).send({
      status: 'error',
      message: "Error fetching transaction status",
      error: error.message,
    });
  }
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('🚨 Global error handler:', err);
  res.status(500).json({
    status: 'error',
    message: 'Internal server error'
  });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  connectToDatabase();
  console.log(`🚀 Server operational on port ${PORT}`);
});