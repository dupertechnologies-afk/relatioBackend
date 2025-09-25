import { validationResult } from 'express-validator';

export const submitContactForm = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { name, email, subject, message } = req.body;

    console.log('Received Contact Form Submission:');
    console.log(`Name: ${name}`);
    console.log(`Email: ${email}`);
    console.log(`Subject: ${subject}`);
    console.log(`Message: ${message}`);

    // In a real application, you would integrate with an email service here (e.g., Nodemailer, SendGrid, Mailgun)
    // Example: await sendEmail(email, subject, `From: ${name} (${email})\n\n${message}`);

    res.status(200).json({
      message: 'Your message has been received! We will get back to you shortly.'
    });
  } catch (error) {
    console.error('Error submitting contact form:', error);
    res.status(500).json({ message: 'Server error submitting contact form' });
  }
};
