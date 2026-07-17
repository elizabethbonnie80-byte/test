'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { LogOut, Settings } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { NotificationBell } from '@/components/notification-bell'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { useT } from '@/components/i18n-provider'
import { BrandMark } from '@/components/brand-mark'

const NAV = [
  { key: 'createDeal', href: '/create-deal' },
  { key: 'dealRoom', href: '/deal-room' },
  { key: 'messages', href: '/messages' },
  { key: 'faq', href: '/faq' },
  { key: 'contact', href: '/contact' },
] as const

export function BrokerHeader() {
  const t = useT('brokerNav')
  const tc = useT('common')
  const pathname = usePathname()
  const router = useRouter()

  const signOut = async () => {
    await createClient().auth.signOut()
    router.push('/sign-in')
    router.refresh()
  }

  return (
    <header className="bg-card border-b border-border sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/deal-room" className="text-xl font-bold text-primary flex-shrink-0">
            <BrandMark />
          </Link>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
                  pathname === item.href
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground hover:text-primary hover:bg-muted'
                }`}
              >
                {t(item.key)}
              </Link>
            ))}
          </nav>

          {/* Right Side Actions */}
          <div className="flex items-center gap-4 ml-auto">
            <LocaleSwitcher />

            {/* Notifications */}
            <NotificationBell role="broker" />

            {/* Settings */}
            <Link href="/settings">
              <Button variant="ghost" size="icon" title={tc('settings')}>
                <Settings className="h-5 w-5" />
              </Button>
            </Link>

            {/* Logout */}
            <Button variant="ghost" size="icon" title={tc('signOut')} onClick={signOut}>
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
