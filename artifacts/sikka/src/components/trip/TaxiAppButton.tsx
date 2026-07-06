import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getTaxiAppOptions, openTaxiApp } from '@/lib/taxiApps';

interface TaxiAppButtonProps {
  fromName: string;
  toName: string;
  label: string;
  className?: string;
}

/** Lets the rider pick which ride-hailing app to open, instead of always
 *  jumping straight into Uber. */
export default function TaxiAppButton({ fromName, toName, label, className }: TaxiAppButtonProps) {
  const options = getTaxiAppOptions(fromName, toName);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className={className ?? 'w-full h-11 rounded-[2rem] gap-2'}>
          <ExternalLink className="h-4 w-4" /> {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-[12rem]">
        {options.map((option) => (
          <DropdownMenuItem key={option.id} onClick={() => openTaxiApp(option)} className="gap-2">
            {option.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
