import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import axios from 'axios';
import { Buffer } from 'buffer';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Middleware Configuration
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// MongoDB Connection with enhanced monitoring
const connectToDatabase = async () => {
  try {
    console.log('[MongoDB] Connecting to database...');
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,  // Increased timeout
      socketTimeoutMS: 45000,
      family: 4
    });
    console.log('✅ [MongoDB] Connection established');

    mongoose.connection.on('connected', () => {
      console.log('[MongoDB] Connection active');
    });
    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️ [MongoDB] Connection lost');
    });
    mongoose.connection.on('error', (err) => {
      console.error('🔴 [MongoDB] Connection error:', err);
    });
  } catch (error) {
    console.error("🔴 [MongoDB] Critical connection failure:", error);
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
    console.log('[MPesa] Refreshing access token...');
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
      headers: { Authorization: `Basic ${auth}` },
    });

    mpesaAccessToken = response.data.access_token;
    tokenExpiryTime = Date.now() + 55 * 60 * 1000;
    console.log("🔑 [MPesa] Access token refreshed");
    console.debug(`[MPesa] Token expires at: ${new Date(tokenExpiryTime).toISOString()}`);
  } catch (error) {
    console.error("🔴 [MPesa] Error fetching access token:", error.message);
    throw error;
  }
}

// M-Pesa Payment Initiation
async function initiateMpesaPayment(phone, amount = 1) {
  try {
    console.log(`[MPesa] Initiating payment for ${phone}`);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[-T:]/g, '');
    const password = Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');

    const phoneString = phone.toString().trim();
    let formattedPhone;

    if (phoneString.startsWith("0")) {
      formattedPhone = `254${phoneString.slice(1)}`;
    } else if (phoneString.startsWith("+254")) {
      formattedPhone = phoneString.slice(1);
    } else if (phoneString.startsWith("254")) {
      formattedPhone = phoneString;
    } else if (phoneString.match(/^\d{9}$/)) {
      formattedPhone = `254${phoneString}`;
    } else {
      throw new Error(`Invalid phone number format: ${phoneString}`);
    }

    if (formattedPhone.length !== 12 || !formattedPhone.match(/^254\d{9}$/)) {
      throw new Error(`Invalid phone number: ${formattedPhone}`);
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

    console.log('[MPesa] Payment initiated:', {
      checkoutRequestID: response.data.CheckoutRequestID,
      merchantRequestID: response.data.MerchantRequestID
    });
    return response.data;
  } catch (error) {
    console.error("🔴 [MPesa] Payment initiation error:", {
      message: error.message,
      response: error.response?.data,
      phone: phone
    });
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
app.get('/', (req, res) => {
  console.log('[Server] Health check received');
  res.send("API is running...");
});

// Vehicle Registration Endpoint
app.post('/register', async (req, res) => {
  try {
    console.log('[Register] New vehicle:', req.body.licensePlate);
    const vehicle = new Vehicle(req.body);
    await vehicle.save();
    console.log('[Register] Vehicle saved:', vehicle._id);
    res.status(201).send({ message: "✔️ Successful Registration" });
  } catch (error) {
    console.error('[Register] Error:', error);
    res.status(500).send({ message: "❌ Error registering vehicle!", error });
  }
});

// Verify and Payment Endpoint
app.post('/verify', async (req, res) => {
  try {
    console.log('[Verify] Request received:', {
      licensePlate: req.body.licensePlate,
      ip: req.ip
    });

    if (!req.body.licensePlate || typeof req.body.licensePlate !== 'string') {
      console.warn('[Verify] Invalid license plate format');
      return res.status(400).json({ error: "Valid license plate required" });
    }

    const licensePlate = req.body.licensePlate.toUpperCase().trim();
    const vehicle = await Vehicle.findOne({ licensePlate }).lean();

    if (!vehicle) {
      console.warn('[Verify] Vehicle not found:', licensePlate);
      return res.status(404).json({ 
        registered: false,
        searchedPlate: licensePlate 
      });
    }

    const paymentResponse = await initiateMpesaPayment(vehicle.contact);
    const transaction = await Transaction.create({
      licensePlate: vehicle.licensePlate,
      phoneNumber: vehicle.contact,
      amount: 1,
      status: 'pending',
      checkoutRequestID: paymentResponse.CheckoutRequestID,
      merchantRequestID: paymentResponse.MerchantRequestID,
    });

    console.log('[Verify] Transaction created:', {
      id: transaction._id,
      licensePlate: transaction.licensePlate,
      status: transaction.status,
      checkoutID: transaction.checkoutRequestID
    });

    return res.json({
      registered: true,
      vehicle,
      transactionId: transaction._id
    });

  } catch (error) {
    console.error('[Verify] Error:', {
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    return res.status(500).json({ 
      error: "Processing error",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// M-Pesa Callback Endpoint
app.post('/mpesa/callback', async (req, res) => {
  try {
    console.log('[Callback] Received:', JSON.stringify(req.body, null, 2));
    
    const { Body } = req.body;
    const { stkCallback } = Body;
    console.log('[Callback] Processing:', stkCallback.CheckoutRequestID);

    const transaction = await Transaction.findOne({
      checkoutRequestID: stkCallback.CheckoutRequestID,
      status: 'pending',
    }).sort({ createdAt: -1 });

    if (!transaction) {
      console.error('[Callback] Transaction not found:', stkCallback.CheckoutRequestID);
      return res.status(404).send({ message: "Transaction not found" });
    }

    if (stkCallback.ResultCode === 0) {
      const metadata = stkCallback.CallbackMetadata.Item;
      const mpesaReceiptNumber = metadata.find(item => item.Name === "MpesaReceiptNumber")?.Value;

      transaction.status = 'success';
      transaction.mpesaReceiptNumber = mpesaReceiptNumber;
      console.log('[Callback] Payment successful:', {
        transactionId: transaction._id,
        receipt: mpesaReceiptNumber
      });
    } else {
      transaction.status = 'failed';
      console.warn('[Callback] Payment failed:', {
        transactionId: transaction._id,
        errorCode: stkCallback.ResultCode,
        errorDesc: stkCallback.ResultDesc
      });
    }

    const savedTx = await transaction.save();
    console.log('[Callback] Transaction updated:', {
      id: savedTx._id,
      status: savedTx.status,
      updatedAt: savedTx.updatedAt
    });

    res.status(200).send({
      status: "success",
      message: "Callback processed successfully",
    });
  } catch (error) {
    console.error("🔴 [Callback] Error:", {
      message: error.message,
      stack: error.stack,
      body: req.body
    });
    res.status(500).send({
      status: "error",
      message: error.message,
    });
  }
});

// Transaction Status Check Endpoint
app.get('/transaction-status/:id', async (req, res) => {
  try {
    console.log('[Status] Checking transaction:', req.params.id);
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      console.warn('[Status] Transaction not found:', req.params.id);
      return res.status(404).send({
        status: 'error',
        message: "Transaction not found",
      });
    }

    console.log('[Status] Returning status:', {
      id: transaction._id,
      status: transaction.status
    });
    res.status(200).send({
      status: transaction.status,
      transactionId: transaction._id,
      mpesaReceiptNumber: transaction.mpesaReceiptNumber,
      updatedAt: transaction.updatedAt,
    });
  } catch (error) {
    console.error("[Status] Error:", error);
    res.status(500).send({
      status: 'error',
      message: "Error fetching transaction status",
      error: error.message,
    });
  }
});

// Check Payment Status Endpoint
app.get('/check-payment/:transactionId', async (req, res) => {
  try {
    console.log('[CheckPayment] Request for:', req.params.transactionId);
    const transaction = await Transaction.findById(req.params.transactionId);
   
    if (!transaction) {
      console.warn('[CheckPayment] Not found:', req.params.transactionId);
      return res.status(404).json({ error: "Transaction not found" });
    }
   
    console.log('[CheckPayment] Returning:', {
      id: transaction._id,
      status: transaction.status
    });
    res.json({
      status: transaction.status,
      licensePlate: transaction.licensePlate,
      updatedAt: transaction.updatedAt
    });
  } catch (error) {
    console.error('[CheckPayment] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ESP8266 Gate Status Endpoint
app.get('/gate-status', async (req, res) => {
  try {
    // Log incoming request details for debugging
    console.log('[GateStatus] New request received', {
      timestamp: new Date().toISOString(),
      ip: req.ip,
      headers: req.headers,
      query: req.query
    });

    // Find the most recent successful transaction
    const transaction = await Transaction.findOne({
      status: "success",
      gateOpened: { $ne: true } // Only find transactions that haven't opened the gate yet
    })
    .sort({ updatedAt: -1 })
    .limit(1)
    .lean();

    if (!transaction) {
      console.log('[GateStatus] No unprocessed successful transactions found');
      return res.status(200).send("deny");
    }

    // Calculate payment age in minutes
    const paymentAge = (new Date() - new Date(transaction.updatedAt)) / (1000 * 60);
    console.log('[GateStatus] Transaction details:', {
      transactionId: transaction._id,
      licensePlate: transaction.licensePlate,
      paymentAgeMinutes: paymentAge.toFixed(2),
      receipt: transaction.mpesaReceiptNumber
    });

    // Check if payment is still valid (within 5 minutes)
    if (paymentAge <= 5) {
      console.log('[GateStatus] Allowing access for transaction:', transaction._id);
      
      // Mark transaction as used (optional)
      await Transaction.updateOne(
        { _id: transaction._id },
        { $set: { gateOpened: true, gateOpenedAt: new Date() } }
      );
      
      return res.status(200).send(`allow:${transaction._id}`);
    }

    console.log('[GateStatus] Payment expired:', {
      transactionId: transaction._id,
      ageMinutes: paymentAge.toFixed(2)
    });
    
    res.status(200).send("deny");
  } catch (error) {
    console.error("[GateStatus] Critical error:", {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    // Send deny response even in case of errors to keep gate secure
    res.status(500).send("deny");
  }
});

// Debug Endpoint
app.get('/debug/transactions', async (req, res) => {
  try {
    const count = await Transaction.countDocuments();
    const recent = await Transaction.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();
    
    console.log('[Debug] Transaction summary:', { count });
    res.json({
      count,
      recent,
      dbStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      mpesaToken: mpesaAccessToken ? 'valid' : 'invalid'
    });
  } catch (error) {
    console.error('[Debug] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Global Error Handler
app.use((err, req, res, next) => {
  const errorLog = {
    timestamp: new Date().toISOString(),
    path: req.path,
    method: req.method,
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    body: req.body
  };
  console.error('🚨 [Global] Unhandled error:', errorLog);
  res.status(500).json({
    status: 'error',
    message: 'Internal server error'
  });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`[Server] Starting on port ${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[Server] MPesa Callback URL: ${process.env.MPESA_CALLBACK_URL}`);
  connectToDatabase();
  console.log(`🚀 [Server] Operational on port ${PORT}`);
});