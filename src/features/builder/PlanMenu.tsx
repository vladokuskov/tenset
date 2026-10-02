import { Link } from '@tanstack/react-router'
import { ClipboardPaste, FileDown, Info, Printer, QrCode, Scale, Settings, Shield, type LucideIcon } from 'lucide-react'
import { useMessages } from '../../i18n/messages'
import { Sheet } from '../../ui'
import { builderMessages } from './messages'

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
  { icon: Printer, labelKey: 'print', to: '/print' },
  { icon: Settings, labelKey: 'settings', to: '/settings' },
  { icon: Scale, labelKey: 'credits', to: '/credits' },
  { icon: Shield, labelKey: 'privacy', to: '/privacy' },
  { icon: Info, labelKey: 'about', to: '/about' },
] as const

/** Plan overflow menu. Share, export and paste open their sheets in place; the rest are pages. */
export function PlanMenu({
  open,
  onClose,
  onShare,
  onExport,
  onPaste,
}: {
  open: boolean
  onClose: () => void
  onShare: () => void
  onExport: () => void
  onPaste: () => void
}) {
  const m = useMessages(builderMessages)
  return (
    <Sheet open={open} onClose={onClose} title={m.plan} desktop="center">
      <ul className="-mx-2">
        <MenuButton icon={QrCode} label={m.menu.share} onClick={onShare} />
        <MenuButton icon={FileDown} label={m.menu.export} onClick={onExport} />
        <MenuButton icon={ClipboardPaste} label={m.menu.paste} onClick={onPaste} />
        {LINKS.map(({ icon: Icon, labelKey, to }) => (
          <li key={to}>
            <Link to={to} replace className={row}>
              <Icon size={20} strokeWidth={1.75} className="text-ink-2" aria-hidden />
              {m.menu[labelKey]}
            </Link>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
