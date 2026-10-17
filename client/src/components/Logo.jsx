import { Link } from 'react-router-dom';

// Mark: two overlapping peaks with the sun resting on the summit
export function LogoMark({ title }) {
  return (
    <svg viewBox="0 0 32 32" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <rect width="32" height="32" rx="9" fill="#12103a" />
      <path d="M4 25 14 8l5.5 9.2L22.2 13 28 25z" fill="#fff" />
      <path d="M14 8l-3.4 5.7L14 17l2.5-3.2z" fill="#4b3fe0" />
      <circle cx="22.5" cy="7.5" r="3" fill="#ffb020" />
    </svg>
  );
}

export default function Logo({ light = false, to = '/' }) {
  return (
    <Link to={to} className={`logo${light ? ' light' : ''}`} aria-label="PeakIQ home">
      <LogoMark />
      PeakIQ
    </Link>
  );
}
