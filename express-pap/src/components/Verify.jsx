import React, { useState, useEffect, useCallback } from 'react';

const Verify = () => {
  const [licensePlate, setLicensePlate] = useState('');
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [vehicle, setVehicle] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [transactionId, setTransactionId] = useState(null);
  const [transactionStatus, setTransactionStatus] = useState(null);
  const [errors, setErrors] = useState({});
  const [pollCount, setPollCount] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // API URLs
  const API_BASE_URL = 'https://expresspap.onrender.com';
  const LPR_API_URL = 'https://6e6b-105-160-73-172.ngrok-free.app';

  console.log("LPR_API_URL:", LPR_API_URL);


  // Drag and drop handlers
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        setImage(file);
        const reader = new FileReader();
        reader.onload = () => {
          setImagePreview(reader.result);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  // File input change handler
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      setImage(file);
      const reader = new FileReader();
      reader.onload = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Remove image handler
  const removeImage = () => {
    setImage(null);
    setImagePreview(null);
  };

  // Poll transaction status
  useEffect(() => {
    let pollInterval;

    const checkStatus = async () => {
      if (!transactionId) return;

      try {
        setPaymentLoading(true);
        const response = await fetch(`${API_BASE_URL}/transaction-status/${transactionId}`);
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();

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
      } finally {
        setPaymentLoading(false);
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
    setOcrLoading(!!image);
    setPaymentLoading(false);
    setMessage('Processing your request. This may take a moment...');
    setVehicle(null);
    setTransactionStatus('pending');
    setTransactionId(null);

    try {
      let extractedLicensePlate = licensePlate.toUpperCase().trim();

      // If an image is uploaded, send it to the Python backend for OCR
      if (image) {
        const formData = new FormData();
        formData.append('image', image);

        setMessage('Processing license plate image...');
        setOcrLoading(true);
        
        const lprResponse = await fetch(`${LPR_API_URL}/upload`, {
          method: 'POST',
          body: formData,
          signal: AbortSignal.timeout(40000), 
        });

        if (!lprResponse.ok) {
          throw new Error(`Python backend error: ${lprResponse.statusText}`);
        }

        const lprData = await lprResponse.json();
        console.log("Python backend response:", lprData);

        if (!lprData.licensePlate) {
          throw new Error("Failed to extract license plate from image.");
        }

        extractedLicensePlate = lprData.licensePlate.toUpperCase().trim();
        setOcrLoading(false);
      }

      // Send the license plate to the Node.js backend for payment initiation
      setMessage('Verifying vehicle registration...');
      
      const verifyResponse = await fetch(`${API_BASE_URL}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          licensePlate: extractedLicensePlate,
        }),
      });

      if (!verifyResponse.ok) {
        throw new Error(`Node.js backend error: ${verifyResponse.statusText}`);
      }

      const verifyData = await verifyResponse.json();
      console.log("Node.js backend response:", verifyData);

      if (verifyData.registered) {
        setVehicle(verifyData.vehicle);
        setTransactionId(verifyData.transactionId);
        setMessage("Please check your phone to complete the M-Pesa payment.");
        setPaymentLoading(true);
      } else {
        setTransactionStatus(null);
        setMessage(verifyData.message || "Vehicle not found. Please register.");
      }
    } catch (error) {
      console.error("Verify error:", error);
      setTransactionStatus('error');
      setMessage(error.message || "Error verifying vehicle. Please try again.");
      setOcrLoading(false);
      setPaymentLoading(false);
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
            placeholder="Enter License Plate (e.g., KAT 197D)"
            value={licensePlate}
            onChange={(e) => setLicensePlate(e.target.value)}
            className={`w-full px-3 py-2 border rounded bg-transparent text-white placeholder-light-200 ${
              errors.licensePlate ? 'border-red-500' : 'border-gray-300'
            }`}
            disabled={loading}
          />
          {errors.licensePlate && <div className="text-red-500 text-sm mt-1">{errors.licensePlate}</div>}
        </div>

        {/* Drag and Drop Area */}
        <div 
          className={`border-2 border-dashed rounded-lg p-6 text-center ${
            isDragging ? 'border-primary bg-primary/10' : 'border-gray-300'
          }`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {imagePreview ? (
            <div className="relative">
              <img 
                src={imagePreview} 
                alt="Preview" 
                className="max-h-48 mx-auto mb-4 rounded"
              />
              <button
                onClick={removeImage}
                className="absolute top-0 right-0 bg-red-500 text-white rounded-full p-1"
              >
                ✕
              </button>
              <p className="text-light-200">Image ready for processing</p>
            </div>
          ) : (
            <>
              <p className="text-light-200 mb-2">Drag & drop vehicle image here</p>
              <p className="text-light-200 text-sm mb-4">or</p>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="bg-primary text-white px-4 py-2 rounded hover:bg-primary/90 transition-colors cursor-pointer"
              >
                Select Image
              </label>
            </>
          )}
        </div>

        {/* Verify Button */}
        <button
          onClick={handleVerify}
          disabled={loading}
          className="w-full bg-primary text-white px-4 py-2 rounded hover:bg-primary/90 transition-colors flex justify-center items-center"
        >
          {loading ? (
            <>
              {ocrLoading && (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing Image...
                </span>
              )}
              {paymentLoading && (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Waiting for Payment...
                </span>
              )}
              {!ocrLoading && !paymentLoading && 'Verifying...'}
            </>
          ) : 'Verify'}
        </button>

        {/* Vehicle Information Display */}
        {vehicle && (
          <div className="mt-4 p-4 bg-gray-800 rounded-lg">
            <h3 className="text-lg font-semibold text-white mb-2">Vehicle Information</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-light-200">Owner:</p>
                <p className="text-white">{vehicle.ownerName}</p>
              </div>
              <div>
                <p className="text-light-200">Plate:</p>
                <p className="text-white">{vehicle.licensePlate}</p>
              </div>
              <div>
                <p className="text-light-200">Type:</p>
                <p className="text-white">{vehicle.carType}</p>
              </div>
              <div>
                <p className="text-light-200">Brand:</p>
                <p className="text-white">{vehicle.brand}</p>
              </div>
              <div>
                <p className="text-light-200">Color:</p>
                <p className="text-white">{vehicle.color}</p>
              </div>
              <div>
                <p className="text-light-200">Contact:</p>
                <p className="text-white">{vehicle.contact}</p>
              </div>
            </div>
          </div>
        )}

        {/* Status Message */}
        {message && (
          <div className={`mt-4 p-3 rounded ${
            transactionStatus === 'success' ? 'bg-green-600' :
            transactionStatus === 'failed' || transactionStatus === 'error' ? 'bg-red-600' :
            'bg-blue-500'
          } text-white`}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
};

export default Verify;