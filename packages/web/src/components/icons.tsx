import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    />
  );
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M5 13l4 4L19 7" />
    </Icon>
  );
}

export function BookmarkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-3.5L6 20V5a1 1 0 0 1 1-1z" />
    </Icon>
  );
}

export function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M6 9l6 6 6-6" />
    </Icon>
  );
}

export function SparkleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 3l1.7 5 5.3 1.7-5.3 1.8L12 17l-1.7-5.5L5 9.7 10.3 8z" />
    </svg>
  );
}

export function GlobeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx={12} cy={12} r={9} />
      <path d="M3 12h18M12 3c2.5 2.5 2.5 13.5 0 18M12 3c-2.5 2.5-2.5 13.5 0 18" />
    </Icon>
  );
}

export function PencilIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </Icon>
  );
}

export function AlertTriangleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 4L21 20H3L12 4z" />
      <path d="M12 10v4M12 16.5h.01" />
    </Icon>
  );
}

export function CompassIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx={12} cy={12} r={9} />
      <path d="M14.5 9.5l-2 5-3 1 2-5 3-1z" />
    </Icon>
  );
}

export function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}

export function PlaneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 12l18-8-8 18-2-8-8-2z" />
    </Icon>
  );
}

export function BuildingIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x={5} y={3} width={14} height={18} rx={1} />
      <path d="M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1" />
    </Icon>
  );
}

export function ChevronRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M9 6l6 6-6 6" />
    </Icon>
  );
}

export function ChevronDownRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M6 5v9a4 4 0 0 0 4 4h8" />
      <path d="M14 14l4 4-4 4" />
    </Icon>
  );
}

export function TrainIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x={6} y={3} width={12} height={14} rx={4} />
      <path d="M6 12h12M9 17l-2 3M15 17l2 3" />
      <circle cx={9.5} cy={9} r={0.6} fill="currentColor" stroke="none" />
      <circle cx={14.5} cy={9} r={0.6} fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function CarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 16v-3.5L6 8h12l2 4.5V16" />
      <path d="M4 16h16M6 16v2M18 16v2" />
      <circle cx={7.5} cy={16} r={1.2} fill="currentColor" stroke="none" />
      <circle cx={16.5} cy={16} r={1.2} fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v9h12v-9" />
      <path d="M10 19v-5h4v5" />
    </Icon>
  );
}

export function ClockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx={12} cy={12} r={9} />
      <path d="M12 7v5l3.5 2" />
    </Icon>
  );
}
