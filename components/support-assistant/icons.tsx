// Inline SVG icons for the support assistant. Drawn here rather than loaded from an icon
// font or CDN, so the page needs no third-party requests. All are decorative: the text
// beside each icon carries the meaning.
import type { ReactNode } from 'react';

function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

// A heart above an open hand: care offered.
export function LogoIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M15.5 3.2c-.9 0-1.7.5-2 1.2-.3-.7-1.1-1.2-2-1.2-1.2 0-2.1.9-2.1 2.1 0 2 4.1 4.4 4.1 4.4s4.1-2.4 4.1-4.4c0-1.2-.9-2.1-2.1-2.1Z" />
      <path d="M2.5 13.5h3v7h-3z" />
      <path d="M5.5 19h8.2c.8 0 1.6-.3 2.2-.9l5-4.6c.6-.6.6-1.5 0-2-.5-.5-1.3-.5-1.9-.1l-3.5 2.6" />
      <path d="M5.5 14.5l2.3-1.6c.6-.4 1.3-.6 2-.6h3.9c.8 0 1.4.6 1.4 1.4s-.6 1.4-1.4 1.4H10.5" />
    </Icon>
  );
}

export function ChatIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M3.5 5.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-3.5 3v-3a2 2 0 0 1-2-2Z" />
      <path d="M16.5 8.5h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2v3l-3.5-3h-4a2 2 0 0 1-2-2v-.5" />
    </Icon>
  );
}

export function SendIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M4 12 3 4l18 8-18 8 1-8Zm0 0h8" />
    </Icon>
  );
}

export function HeartIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10Z" />
    </Icon>
  );
}

export function BuildingIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M3 9.5 12 4l9 5.5M4.5 20.5h15M6 10.5v7.5M10 10.5v7.5M14 10.5v7.5M18 10.5v7.5" />
    </Icon>
  );
}

export function ShieldIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M12 3.5 5 6v5.5c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6Z" />
    </Icon>
  );
}

export function AlertIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M12 3.2 20.8 12 12 20.8 3.2 12Z" />
      <path d="M12 8.2v4.6M12 15.8h.01" />
    </Icon>
  );
}

export function ChevronIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function ExternalIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H10" />
    </Icon>
  );
}
