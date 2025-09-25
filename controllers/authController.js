import jwt from 'jsonwebtoken';
import { validationResult } from 'express-validator';
import User from '../models/User.js';
import { nanoid } from 'nanoid'; // Import nanoid

const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET || 'fallback_secret',
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

export const signup = async (req, res) => {
  try {
    console.log("=======1");
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    console.log("=======2");
    const { username, email, password, firstName, lastName } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });
    console.log("=======3");
    if (existingUser) {
      return res.status(400).json({
        message: existingUser.email === email 
          ? 'Email already registered' 
          : 'Username already taken'
      });
    }
    console.log('🟢 Received signup request');
    console.log('🟢 Data:', req.body);
    // Create new user
    const user = new User({
      username,
      email,
      password,
      firstName,
      lastName
    });

    console.log('🟡 Before saving user');

    await user.save();
    
    console.log('🟢 After saving user');
    

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        avatar: user.avatar,
        registrationId: user.registrationId // Add registrationId
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ message: 'Server error during signup' });
  }
};

export const login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // If registrationId is missing, generate and save it
    if (!user.registrationId) {
      let uniqueId = nanoid(10);
      let userWithId = await User.findOne({ registrationId: uniqueId });
      while (userWithId) {
        uniqueId = nanoid(10);
        userWithId = await User.findOne({ registrationId: uniqueId });
      }
      user.registrationId = uniqueId;
      await user.save(); // Save again to persist new registrationId
    }

    // Generate token
    const token = generateToken(user._id);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        avatar: user.avatar,
        preferences: user.preferences,
        registrationId: user.registrationId // Add registrationId
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
};

export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // If registrationId is missing, generate and save it
    if (!user.registrationId) {
      let uniqueId = nanoid(10);
      let userWithId = await User.findOne({ registrationId: uniqueId });
      while (userWithId) {
        uniqueId = nanoid(10);
        userWithId = await User.findOne({ registrationId: uniqueId });
      }
      user.registrationId = uniqueId;
      await user.save(); // Save again to persist new registrationId
    }

    res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        avatar: user.avatar,
        bio: user.bio,
        dateOfBirth: user.dateOfBirth,
        preferences: user.preferences,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt,
        registrationId: user.registrationId // Add registrationId
      }
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const allowedUpdates = ['firstName', 'lastName', 'bio', 'avatar', 'dateOfBirth', 'preferences'];
    const updates = {};

    // Only include allowed fields
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updates,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        avatar: user.avatar,
        bio: user.bio,
        dateOfBirth: user.dateOfBirth,
        preferences: user.preferences,
        registrationId: user.registrationId // Add registrationId
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Server error during profile update' });
  }
};

export const searchUsers = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { q, registrationId } = req.query;
    let users = [];

    if (q) {
      // Search by email or username
      users = await User.find({
        $or: [
          { username: { $regex: q, $options: 'i' } },
          { email: { $regex: q, $options: 'i' } }
        ],
        ...(req.user ? { _id: { $ne: req.user.id } } : {}) // Exclude the current user if authenticated
      }).select('firstName lastName username email avatar registrationId'); // Select relevant fields
    } else if (registrationId) {
      // Search by registration ID (assuming it's a unique identifier like _id or a custom regId field)
      const userFound = await User.findOne({
        _id: registrationId, // Assuming registrationId is the user's _id
        ...(req.user ? { _id: { $ne: req.user.id } } : {}) // Exclude current user if authenticated
      }).select('firstName lastName username email avatar registrationId');

      if (userFound) {
        users = [userFound];
      }
    } else {
      return res.status(400).json({ message: 'Search query (q) or registrationId is required.' });
    }

    res.json({
      success: true,
      users: users.map(user => ({
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        registrationId: user.registrationId // Add registrationId
      }))
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ message: 'Server error during user search' });
  }
};