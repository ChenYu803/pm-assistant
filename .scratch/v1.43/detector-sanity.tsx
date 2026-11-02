export default function Sanity() {
  return (
    <div className="sanity">
      <h1 className="sanity-title">Sanity</h1>
      <p className="sanity-tiny">Tiny text sample for detector sanity check.</p>
      <span className="sanity-gradient">Gradient sample</span>
      <style>{`
        .sanity-title {
          font-family: 'Inter', sans-serif;
          font-size: 9px;
          letter-spacing: -0.08em;
        }
        .sanity-tiny {
          font-size: 8px;
          color: #777777;
          background: #ffffff;
        }
        .sanity-gradient {
          background: linear-gradient(90deg, #ff00aa, #00ffaa);
          -webkit-background-clip: text;
          color: transparent;
        }
      `}</style>
    </div>
  );
}
