const LOGOS = [
  ['◇', 'Boltshift'],
  ['◎', 'Lightbox'],
  ['✳', 'Spherule'],
  ['◍', 'GlobalBank'],
  ['❋', 'Nietzsche'],
];

export default function LogoStrip() {
  return (
    <div className="logos">
      {LOGOS.map(([glyph, name]) => (
        <span className="logo" key={name}><span className="logo-g">{glyph}</span> {name}</span>
      ))}
    </div>
  );
}
