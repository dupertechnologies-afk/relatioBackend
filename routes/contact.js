import express from 'express';
import { body } from 'express-validator';
import { submitContactForm } from '../controllers/contactController.js';

const router = express.Router();

const contactFormValidation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('subject').trim().notEmpty().withMessage('Subject is required'),
  body('message').trim().notEmpty().withMessage('Message is required').isLength({ min: 10 }).withMessage('Message must be at least 10 characters long'),
];

router.post('/', contactFormValidation, submitContactForm);

export default router;
