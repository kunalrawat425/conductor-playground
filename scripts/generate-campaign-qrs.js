import fs from 'fs';
import path from 'path';

// Define the assets and their API endpoints for 1000x1000px high-res print QRs
const qrs = [
  {
    name: 'qr-campaign-flyer.png',
    url: 'https://api.qrserver.com/v1/create-qr-code/?size=1000x1000&data=https%3A%2F%2Frelifish.store%2F%3Futm_source%3Doffline_qr%26utm_medium%3Dfold_brochure%26utm_campaign%3Dpomfret_cover%26utm_content%3Dfish_fold_design&bgcolor=ffffff&color=0a2472&qzone=4&margin=4'
  },
  {
    name: 'qr-door-hanger.png',
    url: 'https://api.qrserver.com/v1/create-qr-code/?size=1000x1000&data=https%3A%2F%2Frelifish.store%2F%3Futm_source%3Doffline_qr%26utm_medium%3Dhanger%26utm_campaign%3Dpomfret_cover%26utm_content%3Dfish_fold_design&bgcolor=ffffff&color=0a2472&qzone=4&margin=4'
  }
];

async function downloadQRs() {
  const publicDir = path.join(process.cwd(), 'public');
  
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  for (const qr of qrs) {
    const destPath = path.join(publicDir, qr.name);
    console.log(`Fetching high-resolution QR for ${qr.name}...`);
    
    try {
      const response = await fetch(qr.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch QR code: ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      fs.writeFileSync(destPath, buffer);
      console.log(`Saved successfully: public/${qr.name}`);
    } catch (error) {
      console.error(`Error saving ${qr.name}:`, error);
    }
  }
  console.log('Done!');
}

downloadQRs();
