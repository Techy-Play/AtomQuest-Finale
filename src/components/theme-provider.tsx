'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from 'next-themes';

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      {...props}
      // Suppress the React 19 script-tag-in-render warning (next-themes injects a script for SSR theme detection)
      scriptProps={{ suppressHydrationWarning: true } as React.ScriptHTMLAttributes<HTMLScriptElement>}
    >
      {children}
    </NextThemesProvider>
  );
}
