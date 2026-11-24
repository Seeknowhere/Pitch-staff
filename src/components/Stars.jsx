export function Stars({ n, size = 36, big }) {
  return (
    <span
      className="flex items-end gap-1"
      role="img"
      aria-label={n + " out of 5 stars"}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <svg
          key={i}
          width={big && i === 2 ? size + 8 : size}
          height={big && i === 2 ? size + 8 : size}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"
            fill={i < n ? "#f3d18c" : "none"}
            stroke={i < n ? "#f3d18c" : "var(--line)"}
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </span>
  );
}
