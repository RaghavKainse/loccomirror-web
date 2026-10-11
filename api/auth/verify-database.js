// Vercel Serverless Function: Database User Verification Handler
// Route: /api/auth/verify-database

import mongoose from 'mongoose';
import dns from 'dns';

try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {}

const MONGO_URI = (process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb+srv://raghavkainse:87086Rk@cluster0.q9gylvi.mongodb.net/loccomirror?retryWrites=true&w=majority').trim();

let cachedMongo = global._loccoMongo;
if (!cachedMongo) {
  cachedMongo = global._loccoMongo = { conn: null, promise: null };
}

async function connectMongo() {
  if (cachedMongo.conn && mongoose.connection.readyState === 1) {
    return cachedMongo.conn;
  }
  if (!cachedMongo.promise) {
    let uri = MONGO_URI;
    if (uri.includes('/LoccoMirror')) {
      uri = uri.replace('/LoccoMirror', '/loccomirror');
    }
    cachedMongo.promise = mongoose.connect(uri, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 8000,
    }).then((m) => {
      console.log('[VerifyDB] Connected to MongoDB Atlas loccomirror database');
      return m;
    });
  }
  cachedMongo.conn = await cachedMongo.promise;
  return cachedMongo.conn;
}

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, default: '' },
    avatar: { type: String, default: '' },
    googleId: { type: String, default: '' },
    authProvider: { type: String, default: 'google' },
    plan: { type: String, default: 'pro' },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model('User', userSchema);

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-locco-internal-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let email = req.query.email || (req.body && req.body.email);
    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        inDatabase: false,
        message: 'Email address is required for database verification.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    await connectMongo();

    const user = await User.findOne({ email: normalizedEmail });

    if (!user || user.isActive === false) {
      console.log(`[VerifyDB] User NOT FOUND in database: ${normalizedEmail} -> Logout required!`);
      return res.status(404).json({
        success: false,
        inDatabase: false,
        message: 'User does not exist in the database. Please log out.',
      });
    }

    return res.status(200).json({
      success: true,
      inDatabase: true,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    console.error('[VerifyDB Error]:', error.message);
    return res.status(500).json({
      success: false,
      inDatabase: false,
      message: 'Failed to verify user against database.',
      error: error.message,
    });
  }
}
