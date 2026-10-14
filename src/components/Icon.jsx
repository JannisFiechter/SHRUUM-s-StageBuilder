import iconData from "./iconData.js";

export default function Icon({ name, size = 18, strokeWidth = 2, className = "", title }) {
  const parts = iconData[name];
  if (!parts) return null;
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {parts.map(([Tag, attr], i) => (
        <Tag key={i} {...attr} />
      ))}
    </svg>
  );
}
