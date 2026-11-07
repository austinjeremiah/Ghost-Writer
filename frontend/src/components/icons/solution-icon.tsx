import type { SVGProps } from 'react';

export default function SolutionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="45" height="45" viewBox="0 0 45 45" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M33.7103 22.5C33.7103 28.7 28.6662 33.75 22.4735 33.75C16.2559 33.75 11.2368 28.725 11.2368 22.5C11.2368 16.275 16.2559 11.25 22.4735 11.25C28.6912 11.25 33.7103 16.275 33.7103 22.5H44.9471C44.9471 10.075 34.8839 0 22.4735 0C10.0631 0 0 10.075 0 22.5C0 34.925 10.0631 45 22.4735 45C26.5687 45 30.4142 43.9 33.7103 42V22.5Z" fill="currentColor" />
    </svg>
  );
}
