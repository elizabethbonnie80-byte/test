"use client"

import Link from "next/link"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { BrandMark } from "@/components/brand-mark"

/** Shared header for the unauthenticated pages (sign-in/up, forgot/reset password, pending): brand + language toggle. */
export function AuthHeader() {
  return (
    <header className="bg-card border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="text-xl font-bold text-primary">
            <BrandMark />
          </Link>
          <LocaleSwitcher />
        </div>
      </div>
    </header>
  )
}
