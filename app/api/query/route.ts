export const runtime = "nodejs";

import { MongoClient } from "mongodb";
import { GoogleGenerativeAI } from "@google/generative-ai";

const client = new MongoClient(process.env.MONGODB_URI!);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const query = body.query;

    if (!query) {
      return new Response(
        JSON.stringify({ error: "Query is required" }),
        { status: 400 }
      );
    }

    // 🔹 Generate query embedding (3072 dims)
    const embeddingModel = genAI.getGenerativeModel({
      model: "gemini-embedding-001",
    });

    const embeddingResponse = await embeddingModel.embedContent(query);
    const queryVector = embeddingResponse.embedding.values;

    // 🔹 Connect MongoDB
    if (!client.topology?.isConnected()) {
      await client.connect();
    }

    const db = client.db("ai_meeting");
    const collection = db.collection("documents");

    // 🔹 Perform vector search
    const results = await collection
      .aggregate([
        {
          $vectorSearch: {
  index: "vector_index_2",
  path: "embedding",
  queryVector: queryVector,
  numCandidates: 1000,
  limit: 5
}
        },
        {
          $project: {
            _id: 0,
            meeting_id: 1,
            text: 1,
            score: { $meta: "vectorSearchScore" },
          },
        },
      ])
      .toArray();

    return new Response(
      JSON.stringify({ success: true, results }),
      { status: 200 }
    );
  } catch (error: any) {
    console.error("QUERY ERROR:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Server error" }),
      { status: 500 }
    );
  }
}