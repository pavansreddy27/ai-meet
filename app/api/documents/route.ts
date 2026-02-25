export const runtime = "nodejs";

import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI!);

export async function GET() {
  try {
    if (!client.topology?.isConnected()) {
      await client.connect();
    }

    const db = client.db("ai_meeting");
    const collection = db.collection("documents");

    const totalCount = await collection.countDocuments();

    // Group by meeting_id
    const meetings = await collection.aggregate([
      {
        $group: {
          _id: "$meeting_id",
          chunks: { $sum: 1 },
          topic: { $first: "$topic" },
          department: { $first: "$department" },
          date: { $first: "$date" },
        },
      },
      { $sort: { date: -1 } },
    ]).toArray();

    return new Response(
      JSON.stringify({
        success: true,
        totalDocuments: totalCount,
        meetings,
      }),
      { status: 200 }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500 }
    );
  }
}