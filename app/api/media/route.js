import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "ap-south-1"   // 🔥 hardcode your region
});

export async function GET() {
  try {
    const command = new ListObjectsV2Command({
      Bucket: "ai-meeting-media-bucket"
    });

    const data = await s3.send(command);

    const files = data.Contents || [];

    return Response.json({
      totalMediaFiles: files.length,
      files
    });

  } catch (error) {
    console.error("S3 ERROR:", error);
    return Response.json(
      { error: "Failed to fetch media files" },
      { status: 500 }
    );
  }
}