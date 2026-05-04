export default function Summarize() {
  return (
    <div className="fixture-static">
      <div className="header">
        <h1>Understanding Transformer Architecture in Modern AI</h1>
      </div>
      <div className="container">
        <div className="card">
          <p className="lede">
            The Transformer architecture has revolutionized natural language
            processing and is now becoming the foundation for cutting-edge
            artificial intelligence systems.
          </p>

          <h2>1. The Attention Mechanism</h2>
          <p>
            At the heart of Transformers lies the attention mechanism, allowing
            models to weigh the importance of different parts of input data.
            Unlike RNNs that process sequentially, attention enables parallel
            processing, dramatically improving efficiency.
          </p>

          <h2>2. Encoder-Decoder Structure</h2>
          <p>
            Transformers consist of an encoder that processes input data and a
            decoder that generates output. The encoder builds representations
            capturing contextual relationships, while the decoder uses these
            representations to produce predictions.
          </p>

          <h2>3. Positional Encoding</h2>
          <p>
            Since attention doesn't inherently understand sequence order,
            positional encodings are added to input embeddings, giving the model
            information about token positions in the sequence.
          </p>
        </div>
      </div>
    </div>
  );
}
