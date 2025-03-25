import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import axios from 'axios';
import { Buffer } from 'buffer';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// Enhanced Middleware Configuration
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// MongoDB Connection with Retry Logic
const connectToDatabase = async () => {
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 30000,
        family: 4
      });
      console.log("✅ MongoDB connection established");
      return;
    } catch (error) {
      retryCount++;
      console.error(`🔴 MongoDB connection attempt ${retryCount} failed:`, error);
      if (retryCount === maxRetries) {
        console.error("🔴 Critical MongoDB connection failure");
        process.exit(1);
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

// Enhanced Schemas with Validation
const vehicleSchema = new mongoose.Schema({
  licensePlate: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    validate: {
      validator: function(v) {
        return /^[A-Z0-9]{3,12}$/.test(v);
      },
      message: props => `${props.value} is not a valid license plate!`
    }
  },
  ownerName: {
    type: String,
    required: true,
    trim: true
  },
  contact: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^(0|\+254|254)\d{9}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  carType: String,
  brand: String,
  color: String,
  registrationDate: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

const Vehicle = mongoose.model('Vehicle', vehicleSchema);

const transactionSchema = new mongoose.Schema({
  licensePlate: {
    type: String,
    required: true
  },
  phoneNumber: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true,
    default: 1,
    min: 1
  },
  status: {
    type: String,
    enum: ['pending', 'success', 'failed', 'timeout'],
    default: 'pending'
  },
  mpesaReceiptNumber: String,
  checkoutRequestID: String,
  merchantRequestID: String,
  transactionDate: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

const Transaction = mongoose.model('Transaction', transactionSchema);

// M-Pesa Token Management
let mpesaAccessToken = null;
let tokenExpiryTime = null;

const getMpesaAccessToken = async () => {
  try {
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 10000
    });

    mpesaAccessToken = response.data.access_token;
    tokenExpiryTime = Date.now() + (response.data.expires_in * 1000);
    console.log("🔑 M-Pesa token refreshed");
  } catch (error) {
    console.error("🔴 M-Pesa token error:", error.message);
    throw new Error("Failed to get M-Pesa access token");
  }
};

// Phone Number Formatter
const formatPhoneNumber = (phone) => {
  const phoneString = phone.toString().trim().replace(/\D/g, '');

  if (phoneString.startsWith('0') && phoneString.length === 10) {
    return `254${phoneString.substring(1)}`;
  } else if (phoneString.startsWith('254') && phoneString.length === 12) {
    return phoneString;
  } else if (phoneString.startsWith('7') && phoneString.length === 9) {
    return `254${phoneString}`;
  } else if (phoneString.startsWith('+254') && phoneString.length === 13) {
    return phoneString.substring(1);
  } else {
    throw new Error(`Invalid phone number format: ${phone}`);
  }
};

// Enhanced M-Pesa Payment Initiator
const initiateMpesaPayment = async (phone, amount = 1) => {
  try {
    if (!mpesaAccessToken || Date.now() >= tokenExpiryTime) {
      await getMpesaAccessToken();
    }

    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const password = Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');
    const formattedPhone = formatPhoneNumber(phone);

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
        CallBackURL: `${process.env.API_BASE_URL}/mpesa/callback`,
        AccountReference: 'TOLL-PAYMENT',
        TransactionDesc: 'Toll Payment'
      },
      {
        headers: {
          'Authorization': `Bearer ${mpesaAccessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    if (response.data.ResponseCode !== "0") {
      throw new Error(response.data.ResponseDescription || 'M-Pesa request failed');
    }

    return {
      CheckoutRequestID: response.data.CheckoutRequestID,
      MerchantRequestID: response.data.MerchantRequestID,
      ResponseCode: response.data.ResponseCode,
      ResponseDescription: response.data.ResponseDescription
    };
  } catch (error) {
    console.error("🔴 M-Pesa payment error:", error.response?.data || error.message);
    throw error;
  }
};

// Token Refresh Scheduler
setInterval(async () => {
  try {
    if (!mpesaAccessToken || Date.now() >= tokenExpiryTime - 300000) { // Refresh 5 minutes before expiry
      await getMpesaAccessToken();
    }
  } catch (error) {
    console.error("🔴 Token refresh error:", error.message);
  }
}, 300000); // Check every 5 minutes

// Initialize M-Pesa Token
getMpesaAccessToken().catch(err => {
  console.error("🔴 Initial token fetch failed:", err.message);
});

// Enhanced Routes
app.get('/', (req, res) => {
  res.json({
    status: 'active',
    version: '1.0.0',
    services: ['mpesa', 'ocr', 'database']
  });
});

// Vehicle Registration Endpoint with Phone Validation
app.post('/register', async (req, res) => {
  try {
    const { contact, ...rest } = req.body;
    
    // Format phone number before saving
    const formattedContact = formatPhoneNumber(contact);
    
    const vehicle = new Vehicle({
      ...rest,
      contact: formattedContact
    });

    await vehicle.save();
    
    res.status(201).json({
      success: true,
      message: "Vehicle registered successfully",
      data: {
        licensePlate: vehicle.licensePlate,
        contact: vehicle.contact
      }
    });
  } catch (error) {
    console.error("🔴 Registration error:", error.message);
    res.status(400).json({
      success: false,
      message: error.message.includes('validation') 
        ? error.message 
        : 'Registration failed. Please check your data.'
    });
  }
});

// Verify and Payment Endpoint
app.post('/verify', async (req, res) => {
  try {
    const { licensePlate } = req.body;
    
    if (!licensePlate) {
      return res.status(400).json({
        success: false,
        message: "License plate is required"
      });
    }

    // Case-insensitive search with sanitization
    const cleanPlate = licensePlate.toUpperCase().replace(/\s/g, '');
    const vehicle = await Vehicle.findOne({
      licensePlate: { $regex: new RegExp(`^${cleanPlate}$`, 'i') }
    });

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not registered",
        data: { licensePlate: cleanPlate }
      });
    }

    // Initiate payment
    const payment = await initiateMpesaPayment(vehicle.contact);
    
    // Save transaction
    const transaction = await Transaction.create({
      licensePlate: vehicle.licensePlate,
      phoneNumber: vehicle.contact,
      amount: 1,
      status: 'pending',
      checkoutRequestID: payment.CheckoutRequestID,
      merchantRequestID: payment.MerchantRequestID
    });

    res.status(200).json({
      success: true,
      message: "Payment initiated successfully",
      data: {
        vehicle: {
          licensePlate: vehicle.licensePlate,
          owner: vehicle.ownerName,
          contact: vehicle.contact
        },
        transaction: {
          id: transaction._id,
          status: transaction.status,
          timestamp: transaction.createdAt
        }
      }
    });
  } catch (error) {
    console.error("🔴 Verification error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message.includes('phone number')
        ? "Invalid contact number format"
        : "Payment initiation failed"
    });
  }
});

// M-Pesa Callback Handler
app.post('/mpesa/callback', async (req, res) => {
  try {
    const callback = req.body;
    console.log("📞 M-Pesa callback received:", JSON.stringify(callback, null, 2));

    if (!callback.Body.stkCallback) {
      return res.status(400).json({ success: false, message: "Invalid callback format" });
    }

    const { CheckoutRequestID, ResultCode, CallbackMetadata } = callback.Body.stkCallback;
    
    const transaction = await Transaction.findOneAndUpdate(
      { checkoutRequestID: CheckoutRequestID },
      {
        status: ResultCode === 0 ? 'success' : 'failed',
        mpesaReceiptNumber: ResultCode === 0 
          ? CallbackMetadata.Item.find(i => i.Name === 'MpesaReceiptNumber').Value 
          : null,
        $inc: { retryCount: 1 }
      },
      { new: true }
    );

    if (!transaction) {
      console.error("Transaction not found for CheckoutRequestID:", CheckoutRequestID);
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }

    console.log(`💰 Transaction ${transaction._id} updated to status: ${transaction.status}`);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("🔴 Callback processing error:", error);
    res.status(500).json({ success: false, message: "Callback processing failed" });
  }
});

// Transaction Status Check
app.get('/transactions/:id', async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .select('-__v -updatedAt')
      .lean();

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found"
      });
    }

    res.status(200).json({
      success: true,
      data: transaction
    });
  } catch (error) {
    console.error("🔴 Transaction lookup error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching transaction"
    });
  }
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("🚨 Global error:", err.stack);
  res.status(500).json({
    success: false,
    message: "Internal server error",
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  await connectToDatabase();
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 M-Pesa Callback URL: ${process.env.API_BASE_URL}/mpesa/callback`);
});
