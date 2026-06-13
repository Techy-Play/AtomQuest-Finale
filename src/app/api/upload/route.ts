import { NextRequest, NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import { getAuthUser } from '@/lib/auth';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// POST /api/upload — Upload a file to Cloudinary
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'text/plain',
      'video/webm', 'video/mp4', 'video/ogg',
    ];
    const isVideo = file.type.startsWith('video/') || file.name.endsWith('.webm');
    if (!allowedTypes.includes(file.type) && !isVideo) {
      return NextResponse.json(
        { error: 'File type not supported. Only images, PDFs, and videos are allowed.' },
        { status: 400 }
      );
    }

    // Validate file size (500MB for video, 10MB for others)
    const MAX_SIZE = isVideo ? 500 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size === 0) {
      return NextResponse.json({ error: 'Empty file' }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: `File too large. Max ${isVideo ? '500MB' : '10MB'} allowed.` }, { status: 400 });
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Determine resource type
    const resourceType: 'video' | 'raw' | 'image' = isVideo ? 'video' : file.type === 'application/pdf' ? 'raw' : 'image';
    const folder = isVideo ? 'connectdesk/recordings' : 'connectdesk/chat';

    // Upload to Cloudinary
    const result = await new Promise<any>((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          resource_type: resourceType,
          folder,
          public_id: `${user.userId}_${Date.now()}`,
          use_filename: true,
          unique_filename: true,
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      ).end(buffer);
    });

    return NextResponse.json({
      url: result.secure_url,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      resourceType,
    });
  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: error.message || 'Upload failed' },
      { status: 500 }
    );
  }
}
