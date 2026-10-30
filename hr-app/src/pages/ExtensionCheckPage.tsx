import ExtensionCheckPanel from '@/components/extensions/ExtensionCheckPanel'
import { PageHeader } from '@/components/ui/Surface'

/**
 * An organization's AI-extension check: the blocklist, the defaults new jobs start from, and
 * the extensions seen on candidates' browsers. Admins edit; HR sees the same page read-only.
 */
export default function ExtensionCheckPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="AI extension check" />
      <ExtensionCheckPanel />
    </div>
  )
}
