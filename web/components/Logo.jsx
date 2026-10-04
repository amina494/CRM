import wordmark from '../assets/yax-wordmark.svg?raw';

/** The YAX wordmark, drawn in the current text colour. */
export default function Logo({ className = '', height = 24 }) {
  return (
    <span className={`logo ${className}`} style={{ height }} role="img" aria-label="YAX"
      dangerouslySetInnerHTML={{ __html: wordmark }} />
  );
}
