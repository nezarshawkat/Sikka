import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ThemeToggle = ({ className }: { className?: string }) => {
  const [dark, setDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sikka-theme') === 'dark' ||
        (!localStorage.getItem('sikka-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('sikka-theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={() => setDark(!dark)}
      className={className}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
};

export default ThemeToggle;
