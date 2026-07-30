import {
  FirehoseClient,
  PutRecordCommand,
} from "@aws-sdk/client-firehose";
import { createIngestHandler } from "./ingest-policy.ts";

const firehose = new FirehoseClient({});

export const handler = createIngestHandler({
  async put(record) {
    const streamName = process.env.DELIVERY_STREAM_NAME;
    if (!streamName) throw new Error("delivery stream is not configured");
    await firehose.send(
      new PutRecordCommand({
        DeliveryStreamName: streamName,
        Record: { Data: Buffer.from(`${JSON.stringify(record)}\n`, "utf8") },
      }),
    );
  },
});
