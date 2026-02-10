import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

// Skip local check to force remote download if needed, or rely on cache
// env.allowLocalModels = false; 

let embedder: FeatureExtractionPipeline | null = null;

// Initialize the pipeline
async function init() {
    try {
        // "Xenova/all-MiniLM-L6-v2" is a small, efficient model for embeddings
        embedder = await pipeline(
            "feature-extraction",
            "Xenova/all-MiniLM-L6-v2",
            {
                dtype: "fp32", // fp32 is safer for Voy/serialization compatibility
                device: "wasm"
            }
        );
        self.postMessage({ action: "ready" });
    } catch (error: any) {
        self.postMessage({ action: "error", error: error.message });
    }
}

self.onmessage = async (e: MessageEvent) => {
    const { action, text, requestId } = e.data;

    if (action === "embed") {
        if (!embedder) {
            self.postMessage({
                action: "error",
                requestId,
                error: "Embedder not initialized"
            });
            return;
        }

        try {
            // pooling: 'mean' and normalize: true are standard for sentence embeddings
            const output = await embedder(text, { pooling: "mean", normalize: true });

            // output.data is Float32Array
            const embedding = Array.from(output.data);

            self.postMessage({
                action: "embed_result",
                requestId,
                embedding
            });
        } catch (error: any) {
            self.postMessage({
                action: "error",
                requestId,
                error: error.message
            });
        }
    }
};

init();
