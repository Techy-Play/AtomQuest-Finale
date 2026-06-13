'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from 'next-themes';

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      {...props}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scriptProps={{ suppressHydrationWarning: true } as any}
    >
      {children}
    </NextThemesProvider>
  );
}
