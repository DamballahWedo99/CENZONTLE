/**
 * EcosystemSwitcher Component
 *
 * Dropdown to switch between different ecosystem modules
 */

'use client';

import * as React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { CaretSortIcon } from '@radix-ui/react-icons';
import { Ecosystem } from '@/config/ecosystems';

interface EcosystemSwitcherProps {
  ecosystems: Ecosystem[];
}

export function EcosystemSwitcher({ ecosystems }: EcosystemSwitcherProps) {
  const [selectedEcosystem, setSelectedEcosystem] = React.useState(ecosystems[0]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between px-3 hover:bg-accent/50"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
              <span className="text-xs font-bold text-primary">
                {selectedEcosystem.name.charAt(0)}
              </span>
            </div>
            <div className="flex flex-col items-start">
              <span className="text-sm font-semibold">{selectedEcosystem.name}</span>
              <span className="text-xs text-muted-foreground">{selectedEcosystem.plan}</span>
            </div>
          </div>
          <CaretSortIcon className="h-4 w-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start">
        <DropdownMenuLabel>Ecosistemas</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ecosystems.map((ecosystem) => (
          <DropdownMenuItem
            key={ecosystem.name}
            onClick={() => setSelectedEcosystem(ecosystem)}
            className="cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
                <span className="text-xs font-bold text-primary">
                  {ecosystem.name.charAt(0)}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{ecosystem.name}</span>
                <span className="text-xs text-muted-foreground">{ecosystem.plan}</span>
              </div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
