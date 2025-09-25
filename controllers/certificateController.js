import { validationResult } from 'express-validator';
import Certificate from '../models/Certificate.js';
import Relationship from '../models/Relationship.js';
import User from '../models/User.js';
import PDFDocument from 'pdfkit';
import blobStream from 'blob-stream';

export const generateRelationshipCertificate = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { relationshipId } = req.params;
    const userId = req.user.id;

    const relationship = await Relationship.findById(relationshipId)
      .populate('initiator', 'firstName lastName')
      .populate('partner', 'firstName lastName');

    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }

    if (!relationship.includesUser(userId)) {
      return res.status(403).json({ message: 'Access denied. You are not part of this relationship.' });
    }

    if (!relationship.initiator || !relationship.partner) {
      return res.status(500).json({ message: 'Could not retrieve full user details for the relationship.' });
    }

    const initiatorFullName = `${relationship.initiator.firstName} ${relationship.initiator.lastName}`;
    const partnerFullName = `${relationship.partner.firstName} ${relationship.partner.lastName}`;
    const partners = [relationship.initiator, relationship.partner];

    // Create a new PDF document
    const doc = new PDFDocument({ 
      size: 'A4', 
      layout: 'landscape', // Certificates often look better in landscape
      margin: 50 
    });

    // Pipe the PDF to a buffer
    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', async () => {
      let pdfBuffer = Buffer.concat(buffers);
      
      // After PDF is generated, save certificate record to DB
      const newCertificate = await Certificate.create({
        relatedTo: 'relationship',
        relatedId: relationship._id,
        title: `Certificate of ${relationship.title} Relationship`,
        description: `This certifies the ${relationship.title} relationship between ${initiatorFullName} and ${partnerFullName}, with a current status of '${relationship.status}'.`,
        type: 'relationship',
        level: 'gold', // Default level for relationship certificates
        recipients: partners.map(p => ({ user: p._id, awardedAt: new Date() })),
        design: {
          template: 'romantic',
          colors: { primary: '#ec4899', secondary: '#f0abfc', accent: '#f59e0b' },
          icon: 'heart',
          backgroundImage: '/images/certificate-background.png'
        },
        metadata: {
          issuedBy: 'RelationApp',
          validUntil: null, // Relationship certificates don't usually expire
          customData: { relationshipStatus: relationship.status }
        }
      });

      // Update the relationship with the new certificate ID
      relationship.latestCertificate = newCertificate._id;
      await relationship.save();
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${relationship.title}-certificate.pdf"`); // Use inline for viewing
      res.send(pdfBuffer);
    });

    // --- Certificate Design --- //
    const docWidth = doc.page.width;
    const docHeight = doc.page.height;
    const centerX = docWidth / 2;
    const marginX = 50;
    let currentY = 50;

    // Background/Border
    doc.rect(20, 20, docWidth - 40, docHeight - 40).stroke('#4A5568');

    // Certificate Number and Issued Date (top right and left)
    doc.font('Helvetica').fontSize(10).fillColor('#718096');
    doc.text(`Certificate No: ${newCertificate._id}`, marginX, currentY, { align: 'left' });
    doc.text(`Issued On: ${new Date().toLocaleDateString()}`, docWidth - marginX, currentY, { align: 'right' });
    currentY += 30;

    // Title
    doc.font('Helvetica-Bold').fontSize(36).fillColor('#4A5568')
      .text('CERTIFICATE OF RELATIONSHIP', 0, currentY, { align: 'center' });
    currentY += 40;

    doc.font('Helvetica').fontSize(18).fillColor('#718096')
      .text('Proudly presented to', 0, currentY, { align: 'center' });
    currentY += 30;

    doc.font('Helvetica-Bold').fontSize(30).fillColor('#2D3748')
      .text(`${initiatorFullName} & ${partnerFullName}`, 0, currentY, { align: 'center' });
    currentY += 50;

    doc.font('Helvetica').fontSize(16).fillColor('#718096')
      .text(`For their enduring ${relationship.type.replace(/_/g, ' ')} relationship, affectionately known as:`, 0, currentY, { align: 'center' });
    currentY += 30;

    doc.font('Helvetica-Bold').fontSize(26).fillColor('#4A5568')
      .text(`"${relationship.title}"`, 0, currentY, { align: 'center' });
    currentY += 50;

    doc.font('Helvetica').fontSize(12).fillColor('#718096')
      .text(`This certificate acknowledges the unique bond and journey shared since ${relationship.startDate ? new Date(relationship.startDate).toLocaleDateString() : 'an unknown date'}.`, 0, currentY, { align: 'center' });
    currentY += 80;

    doc.fontSize(10).fillColor('#718096').text(`Issued by RelationApp on ${new Date().toLocaleDateString()}`, 0, docHeight - 40, { align: 'center' });

    doc.end();

  } catch (error) {
    console.error('Generate relationship certificate error:', error);
    res.status(500).json({ message: 'Server error generating relationship certificate' });
  }
};

export const getCertificates = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { relationshipId } = req.params; // This will be undefined for /certificates
    const { type, level } = req.query;

    const filter = {
      'recipients.user': req.user.id
    };

    // If relationshipId is provided, filter by it and set relatedTo
    if (relationshipId) {
      filter.relatedTo = 'relationship';
      filter.relatedId = relationshipId;
      
      // Additionally, verify relationship exists and user is part of it
      const relationship = await Relationship.findById(relationshipId);
      if (!relationship) {
        return res.status(404).json({ message: 'Relationship not found' });
      }

      if (!relationship.includesUser(req.user.id)) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    if (type) filter.type = type;
    if (level) filter.level = level;

    const certificates = await Certificate.find(filter)
      .populate({
        path: 'relatedId',
        select: 'title type initiator partner',
        // Use a dynamic model based on relatedTo for population
        // This requires an explicit model for each relatedTo type that needs population
        // For simplicity, we'll handle only 'relationship' and 'milestone' for now.
        // If relatedTo is not 'relationship' or 'milestone', relatedId will not be populated with a document from the default model.
        // A more robust solution might involve multiple .populate calls or a virtual populate.
        get model() { 
          if (this.relatedTo === 'relationship') return 'Relationship';
          if (this.relatedTo === 'milestone') return 'Milestone';
          return null; // Don't populate if relatedTo is not a known type
        }
      })
      .populate('recipients.user', 'username firstName lastName avatar')
      .sort({ createdAt: -1 });

    res.json({ certificates });
  } catch (error) {
    console.error('Get certificates error:', error);
    res.status(500).json({ message: 'Server error fetching certificates' });
  }
};

export const getCertificate = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const certificate = await Certificate.findById(req.params.id)
      .populate({ path: 'relatedId', select: 'title type initiator partner', model: 'Relationship' })
      .populate('recipients.user', 'username firstName lastName avatar');

    if (!certificate) {
      return res.status(404).json({ message: 'Certificate not found' });
    }

    // Check if user is a recipient of this certificate
    const isRecipient = certificate.recipients.some(recipient => 
      recipient.user._id.equals(req.user.id)
    );

    if (!isRecipient) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if certificate is valid
    if (!certificate.isValid()) {
      return res.status(400).json({ message: 'Certificate is no longer valid' });
    }

    // Increment view count
    await certificate.incrementView();

    res.json({ certificate });
  } catch (error) {
    console.error('Get certificate error:', error);
    res.status(500).json({ message: 'Server error fetching certificate' });
  }
};

export const downloadCertificate = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const certificate = await Certificate.findById(req.params.id)
      .populate({ path: 'relatedId', select: 'title type startDate initiator partner', model: 'Relationship' })
      .populate('recipients.user', 'username firstName lastName avatar');

    if (!certificate) {
      return res.status(404).json({ message: 'Certificate not found' });
    }

    // Check if user is a recipient of this certificate
    const isRecipient = certificate.recipients.some(recipient => 
      recipient.user._id.equals(req.user.id)
    );

    if (!isRecipient) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if certificate is valid
    if (!certificate.isValid()) {
      return res.status(400).json({ message: 'Certificate is no longer valid' });
    }

    // Increment download count
    certificate.stats.downloadCount += 1;
    await certificate.save();

    // For now, we'll generate a PDF with content
    const doc = new PDFDocument({ 
      size: 'A4', 
      layout: 'landscape', 
      margin: 50 
    });

    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      let pdfBuffer = Buffer.concat(buffers);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="certificate-${req.params.id}.pdf"`);
      res.send(pdfBuffer);
    });

   // --- Certificate Design --- //
const docWidth = doc.page.width;
const docHeight = doc.page.height;
let currentY = 90;

// Elegant Border
doc.lineWidth(4).strokeColor('#C6A664'); // gold border
doc.rect(30, 30, docWidth - 60, docHeight - 60).stroke();

// Inner thin border
doc.lineWidth(1).strokeColor('#A0AEC0');
doc.rect(50, 50, docWidth - 100, docHeight - 100).stroke();

// Watermark / Background
doc.fontSize(100).fillColor('#F7FAFC').opacity(0.2)
  .text('Relationship', 0, docHeight/2 - 50, { align: 'center' });
doc.opacity(1);

// Certificate Number and Issued Date (smaller, top area)
doc.font('Helvetica').fontSize(10).fillColor('#718096');
doc.text(`Certificate No: ${certificate._id}`, 60, 60, { align: 'left' });
// doc.text(`Issued On: ${new Date(certificate.createdAt).toLocaleDateString()}`, -60, 60, { align: 'right' });

// Header Title
doc.font('Helvetica-Bold')
  .fontSize(38)
  .fillColor('#2D3748')
  .text('CERTIFICATE OF RELATIONSHIP', 0, currentY, { align: 'center' });
currentY += 70;

// Subtitle
doc.font('Helvetica-Oblique')
  .fontSize(16)
  .fillColor('#4A5568')
  .text('This is proudly presented to', 0, currentY, { align: 'center' });
currentY += 40;

// Recipient Names
doc.font('Times-BoldItalic') // more elegant font
  .fontSize(36)
  .fillColor('#1A202C')
  .text(certificate.recipients.map(r => r.user.fullName || '').join(' & '), 0, currentY, { align: 'center' });
currentY += 70;

// Relationship Title
doc.font('Helvetica')
  .fontSize(16)
  .fillColor('#4A5568')
  .text('In recognition of their enduring bond known as', 0, currentY, { align: 'center' });
currentY += 30;

doc.font('Helvetica-Bold')
  .fontSize(28)
  .fillColor('#C53030')
  .text(`"${certificate.relatedId.title}"`, 0, currentY, { align: 'center' });
currentY += 70;

// Main Description (longer + more meaningful)
doc.font('Helvetica')
  .fontSize(14)
  .fillColor('#2D3748')
  .text(
    `Since ${certificate.relatedId.startDate ? new Date(certificate.relatedId.startDate).toLocaleDateString() : 'an unknown date'}, this relationship has stood as a symbol of love, trust, and togetherness. 
It celebrates the shared journey of growth, challenges overcome, and moments cherished.`,
    100,
    currentY,
    { width: docWidth - 200, align: 'center', lineGap: 6 }
  );
currentY += 100;

// Closing Line
doc.font('Helvetica-Oblique')
  .fontSize(14)
  .fillColor('#4A5568')
  .text(
    `May this bond continue to inspire loyalty, affection, and strength for years to come.`,
    100,
    currentY,
    { width: docWidth - 200, align: 'center', lineGap: 6 }
  );

// Issued By + Date (footer)
doc.font('Helvetica-Oblique')
  .fontSize(12)
  .fillColor('#4A5568')
  .text(
    `Issued by ${certificate.metadata.issuedBy || 'RelationApp'} on ${new Date(certificate.createdAt).toLocaleDateString()}`,
    0,
    docHeight - 80,
    { align: 'center' }
  );
 
    doc.end();

  } catch (error) {
    console.error('Download certificate error:', error);
    res.status(500).json({ message: 'Server error downloading certificate' });
  }
};

export const shareCertificate = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { platform } = req.body;

    const certificate = await Certificate.findById(req.params.id);

    if (!certificate) {
      return res.status(404).json({ message: 'Certificate not found' });
    }

    // Check if user is a recipient of this certificate
    const isRecipient = certificate.recipients.some(recipient => 
      recipient.user.equals(req.user.id)
    );

    if (!isRecipient) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if certificate is valid
    if (!certificate.isValid()) {
      return res.status(400).json({ message: 'Certificate is no longer valid' });
    }

    // Update sharing stats
    if (platform && !certificate.sharing.sharedOn.includes(platform)) {
      certificate.sharing.sharedOn.push(platform);
    }
    certificate.sharing.shareCount += 1;
    certificate.stats.shareCount += 1;

    await certificate.save();

    res.json({
      message: 'Certificate sharing recorded successfully',
      shareUrl: `${process.env.FRONTEND_URL}/certificates/${certificate._id}/public`
    });
  } catch (error) {
    console.error('Share certificate error:', error);
    res.status(500).json({ message: 'Server error sharing certificate' });
  }
};