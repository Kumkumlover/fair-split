const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
    'http://localhost:3000',
    'https://fair-split-eight.vercel.app',
    /\.vercel\.app$/  // allow all vercel preview deployments
];
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (e.g. curl, Postman)
        if (!origin) return callback(null, true);
        const allowed = allowedOrigins.some(o =>
            typeof o === 'string' ? o === origin : o.test(origin)
        );
        if (allowed) return callback(null, true);
        callback(new Error('CORS policy: origin not allowed'));
    }
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const { extractReceiptData } = require('./extractor');
const { calculateFairSplit } = require('./mathEngine');

// The endpoint that we'll implement later
app.post('/api/split', async (req, res) => {
    try {
        const { receipt_base64, description } = req.body;
        if (!receipt_base64 || !description) {
            return res.status(400).json({ error: 'Missing receipt_base64 or description' });
        }
        
        // Step 1: LLM Extraction (Nutlope pattern)
        const extractedData = await extractReceiptData(receipt_base64, description);
        
        // Step 2: Deterministic Math & Graph (AakashSasikumar pattern)
        const finalSplit = calculateFairSplit(extractedData);
        
        // Step 3: Return exact contract
        res.json(finalSplit);
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error: ' + error.message });
    }
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}

module.exports = app;
