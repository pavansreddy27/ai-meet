export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { MongoClient } from "mongodb";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as mammoth from "mammoth";

const client = new MongoClient(process.env.MONGODB_URI!);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const file = formData.get("file") as File;
    const meeting_id = formData.get("meeting_id") as string;  // ✅ IMPORTANT
    const topic = formData.get("topic") as string;
    const department = formData.get("department") as string;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (!meeting_id) {
      return NextResponse.json(
        { error: "meeting_id is required" },
        { status: 400 }
      );
    }

    if (!file.name.endsWith(".docx")) {
      return NextResponse.json(
        { error: "Only DOCX files supported" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // 🔹 Extract text
    const result = await mammoth.extractRawText({ buffer });
    const extractedText = result.value;

    if (!extractedText || extractedText.trim().length === 0) {
      return NextResponse.json(
        { error: "Document contains no readable text" },
        { status: 400 }
      );
    }

    // 🔹 Chunk text
    const chunks = chunkText(extractedText, 800);

    await client.connect();
    const db = client.db("ai_meeting");
    const collection = db.collection("documents");

    // 🔹 Gemini Embedding Model
    const embeddingModel = genAI.getGenerativeModel({
      model: "gemini-embedding-001",
    });

    const docsToInsert: any[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const embeddingResponse = await embeddingModel.embedContent(chunks[i]);

      docsToInsert.push({
        meeting_id,          // ✅ SAME AS DYNAMODB
        chunk_index: i,
        text: chunks[i],
        embedding: embeddingResponse.embedding.values,
        topic,
        department,
        date: new Date(),
      });
    }

    await collection.insertMany(docsToInsert);

    return NextResponse.json({
      success: true,
      meeting_id,
      chunks: chunks.length,
    });
  } catch (error: any) {
    console.error("INGEST ERROR:", error);

    return NextResponse.json(
      { error: error.message || "Server error" },
      { status: 500 }
    );
  }
}

// 🔹 Simple chunking
function chunkText(text: string, size: number) {
  const words = text.split(/\s+/);
  const chunks: string[] = [];

  for (let i = 0; i < words.length; i += size) {
    chunks.push(words.slice(i, i + size).join(" "));
  }

  return chunks;
}