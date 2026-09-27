import { Link } from '@tanstack/react-router'
import { FileDown, Info, Printer, QrCode, Scale, Settings, Shield, type LucideIcon } from 'lucide-react'
import { Sheet } from '../../ui'

const row = 'flex h-12 w-full items-center gap-3 rounded-md px-2 text-left text-base hover:bg-surface-2'

function MenuButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className={row}>
        <Icon size={20} strokeWidth={1.75} className="text-ink-2" aria-hidden />
        {label}
      </button>
    </li>
  )
}

const LINKS = [
  { icon: Printer, label: 'Print', to: '/print' },
  { icon: Settings, label: 'Settings', to: '/settings' },
  { icon: Scale, label: 'Credits', to: '/credits' },
  { icon: Shield, label: 'Privacy', to: '/privacy' },
  { icon: Info, label: 'About', to: '/about' },
] as const

/** Plan overflow menu. Share and export open their sheets in place; the rest are pages. */
export function PlanMenu({
  open,
  onClose,
  onShare,
  onExport,
}: {
  open: boolean
  onClose: () => void
  onShare: () => void
  onExport: () => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Plan" desktop="center">
      <ul className="-mx-2">
        <MenuButton icon={QrCode} label="Share or QR code" onClick={onShare} />
        <MenuButton icon={FileDown} label="Export or import" onClick={onExport} />
        {LINKS.map(({ icon: Icon, label, to }) => (
          <li key={label}>
            <Link to={to} replace className={row}>
              <Icon size={20} strokeWidth={1.75} className="text-ink-2" aria-hidden />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
