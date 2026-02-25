export async function DELETE(
  request: Request,
  context: { params: { meetingId: string } }
) {
  try {
    const meetingId = context.params.meetingId;

    await client.connect();

    const db = client.db("ai_meeting");
    const collection = db.collection("documents");

    const result = await collection.deleteMany({
      meeting_id: { $eq: meetingId.trim() },
    });

    return new Response(
      JSON.stringify({
        success: true,
        deletedCount: result.deletedCount,
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