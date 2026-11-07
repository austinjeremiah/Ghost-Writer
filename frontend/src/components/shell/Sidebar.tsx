'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, Brain, KeyRound, Landmark, LayoutDashboard, ListChecks, Receipt, ShieldPlus } from 'lucide-react';
import Logo from '@/components/icons/logo';
import { useBorrower } from '@/hooks/useBorrower';

export const NAV = [
  { label: 'Home', href: '/', Icon: LayoutDashboard },
  { label: 'Get cover', href: '/cover', Icon: ShieldPlus },
  { label: 'My policies', href: '/policies', Icon: ListChecks },
  { label: 'My memory', href: '/memory', Icon: Brain },
  { label: 'Underwriter', href: '/underwriter', Icon: Landmark },
  { label: 'Agents', href: '/agents', Icon: Bot },
] as const;
const PROOF = { label: 'Proof', href: '/proof', Icon: Receipt } as const;

export function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

function NavItem({ label, href, Icon }: { label: string; href: string; Icon: typeof Bot }) {
  const pathname = usePathname();
  return (
    <Link className="gw-nav-item" href={href} aria-current={isActive(pathname, href) ? 'page' : undefined}>
      <Icon size={18} /> {label}
    </Link>
  );
}

export function Sidebar() {
  const { status } = useBorrower();
  return (
    <aside className="gw-sidebar" aria-label="Main">
      <Link href="/" className="gw-brand" aria-label="Ghostwriter home"><Logo /></Link>
      <nav className="gw-nav">
        {NAV.map((n) => <NavItem key={n.href} {...n} />)}
      </nav>
      <div className="gw-sidebar-bottom">
        {status === 'not_registered' && (
          <Link className="gw-nudge" href="/onboard"><KeyRound size={18} /> Set up your memory</Link>
        )}
        <NavItem {...PROOF} />
      </div>
    </aside>
  );
}

export function MobileNav() {
  return (
    <nav className="gw-mobile-nav" aria-label="Main">
      {[...NAV, PROOF].map((n) => <NavItem key={n.href} {...n} />)}
    </nav>
  );
}
