import React, { useState, useEffect } from 'react';

const Verify = () => {
  const [licensePlate, setLicensePlate] = useState('');
  const [image, setImage] = useState(null);
  const [vehicle, setVehicle] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [transactionId, setTransactionId] = useState(null);
  const [transactionStatus, setTransactionStatus] = useState(null);
  const [errors, setErrors] = useState({});
  const [pollCount, setPollCount] = useState(0);

  // Access environment variables
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL; // Node.js backend
  const LPR_API_URL = import.meta.env.VITE_LPR_API_URL;   // Python backend

  // Debugging: Log environment variables
  console.log("API_BASE_URL:", API_BASE_URL);
  console.log("LPR_API_URL:", LPR_API_URL);

  // Poll transaction status
  useEffect(() => {
    let pollInterval;

    const checkStatus = async () => {
      if (!transactionId) return;

      try {
        const response = await fetch(`${API_BASE_URL}/transaction-status/${transactionId}`);
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();

        console.log('Transaction status check:', data);

        if (data.status === 'success') {
          setTransactionStatus('success');
          setMessage(`✅ Payment successful! Receipt: ${data.mpesaReceiptNumber}`);
          clearInterval(pollInterval);
        } else if (data.status === 'failed') {
          setTransactionStatus('failed');
          setMessage("❌ Payment failed or was cancelled. Please try again.");
          clearInterval(pollInterval);
        } else if (data.status === 'pending') {
          setPollCount((prev) => {
            if (prev >= 12) { // Timeout after 12 polls (60 seconds)
              clearInterval(pollInterval);
              setTransactionStatus('timeout');
              setMessage("Transaction timed out. Please try again or check your M-Pesa messages.");
              return prev;
            }
            return prev + 1;
          });
        }
      } catch (error) {
        console.error("Error checking status:", error);
        clearInterval(pollInterval);
        setTransactionStatus('error');
        setMessage("Error checking payment status. Please check your M-Pesa messages.");
      }
    };

    if (transactionId && transactionStatus === 'pending') {
      setPollCount(0);
      checkStatus();
      pollInterval = setInterval(checkStatus, 5000); // Poll every 5 seconds
    }

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [transactionId, transactionStatus]);

  // Validate input fields
  const validateFields = () => {
    const newErrors = {};
    if (!licensePlate.trim() && !image) newErrors.licensePlate = "License plate or image is required.";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle verification process
  const handleVerify = async () => {
    if (!validateFields()) return;

    setLoading(true);
    setMessage('Processing your request. This may take a moment...');
    setVehicle(null);
    setTransactionStatus('pending');
    setTransactionId(null);

    try {
      let extractedLicensePlate = licensePlate;

      // If an image is uploaded, send it to the Python backend for OCR
      if (image) {
        const formData = new FormData();
        formData.append('image', image);

        console.time("OCR Process");
        const lprResponse = await fetch(`${LPR_API_URL}/upload`, {
          method: 'POST',
          body: formData,
          signal: AbortSignal.timeout(40000), 
        });
        console.timeEnd("OCR Process");

        if (!lprResponse.ok) {
          throw new Error(`Python backend error: ${lprResponse.statusText}`);
        }

        const lprData = await lprResponse.json();
        console.log("Python backend response:", lprData);

        if (!lprData.licensePlate) {
          throw new Error("Failed to extract license plate from image.");
        }

        extractedLicensePlate = lprData.licensePlate;
      }

      // Send the license plate to the Node.js backend for payment initiation
      console.time("Payment Verification");
      const verifyResponse = await fetch(`${API_BASE_URL}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          licensePlate: extractedLicensePlate,
        }),
      });
      console.timeEnd("Payment Verification");

      if (!verifyResponse.ok) {
        throw new Error(`Node.js backend error: ${verifyResponse.statusText}`);
      }

      const verifyData = await verifyResponse.json();
      console.log("Node.js backend response:", verifyData);

      if (verifyData.registered) {
        setVehicle(verifyData.vehicle);
        setTransactionId(verifyData.transactionId);
        setMessage("Please check your phone to complete the M-Pesa payment.");
      } else {
        setTransactionStatus(null);
        setMessage(verifyData.message || "Vehicle not found. Please register.");
      }
    } catch (error) {
      console.error("Verify error:", error);
      setTransactionStatus('error');
      setMessage(error.message || "Error verifying vehicle. Please try again.");
    }

    setLoading(false);
  };

  return (
    <div className="container mx-auto my-4 p-4 bg-dark-100 rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold text-white mb-2">Verify Vehicle</h2>
      <p className="text-light-200 mb-6">Verify your registration status for a smooth experience at toll points.</p>

      <div className="space-y-4">
        {/* License Plate Input */}
        <div>
          <input
            type="text"
            placeholder="Enter License Plate"
            value={licensePlate}
            onChange={(e) => setLicensePlate(e.target.value)}
            className={`w-full px-3 py-2 border rounded bg-transparent text-white placeholder-light-200 ${
              errors.licensePlate ? 'border-red-500' : 'border-gray-300'
            }`}
            disabled={loading}
          />
          {errors.licensePlate && <div className="text-red-500 text-sm mt-1">{errors.licensePlate}</div>}
        </div>

        {/* Image Upload */}
        <div>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setImage(e.target.files[0])}
            className="w-full px-3 py-2 border rounded bg-transparent text-white placeholder-light-200 border-gray-300"
            disabled={loading}
          />
        </div>

        {/* Verify Button */}
        <button
          onClick={handleVerify}
          disabled={loading}
          className="w-full bg-primary text-white px-4 py-2 rounded hover:bg-primary/90 transition-colors"
        >
          {loading ? 'Verifying...' : 'Verify'}
        </button>
      </div>

      {/* Status Message */}
      {message && <div className="mt-4 p-3 rounded bg-blue-500 text-white">{message}</div>}
    </div>
  );
};

export default Verify;
