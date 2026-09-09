import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { X } from 'lucide-react';

type AdRequest = { placement?: string };

/**
 * Web host for the shared ad event. Android uses the native AdMob interstitial
 * directly, so this stays hidden there and never competes with the SDK surface.
 */
const AdMobBanner = () => {
	const [request, setRequest] = useState<AdRequest | null>(null);
	const [canClose, setCanClose] = useState(false);

	useEffect(() => {
		if (Capacitor.getPlatform() === 'android') return;
		const handleRequest = (event: Event) => {
			const detail = (event as CustomEvent<AdRequest>).detail;
			setRequest(detail ?? {});
			setCanClose(false);
		};
		window.addEventListener('sikka:show-interstitial-ad', handleRequest);
		return () => window.removeEventListener('sikka:show-interstitial-ad', handleRequest);
	}, []);

	useEffect(() => {
		if (!request) return;
		const timer = window.setTimeout(() => setCanClose(true), 4000);
		return () => window.clearTimeout(timer);
	}, [request]);

	if (!request) return null;

	return (
		<div className="fixed inset-0 z-[100] flex min-h-screen w-screen items-center justify-center bg-black/95 p-6 text-white">
			<div className="relative flex h-full w-full max-w-2xl flex-col items-center justify-center overflow-hidden rounded-[2rem] border border-white/15 bg-zinc-950 shadow-2xl">
				<div className="absolute left-5 top-5 rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/70">
					Advertisement
				</div>
				<div className="flex aspect-video w-full items-center justify-center bg-gradient-to-br from-zinc-800 via-zinc-950 to-black">
					<div className="text-center">
						<p className="text-lg font-semibold">Sikka</p>
						<p className="mt-2 text-sm text-white/60">Advertisement</p>
					</div>
				</div>
				<p className="mt-5 text-xs text-white/50">{request.placement === 'location_loaded' ? 'Location loaded' : 'Trip completed'}</p>
				<button
					type="button"
					disabled={!canClose}
					onClick={() => setRequest(null)}
					className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
					aria-label={canClose ? 'Close advertisement' : 'Advertisement cannot be closed yet'}
				>
					<X className="h-5 w-5" />
				</button>
			</div>
		</div>
	);
};

export default AdMobBanner;
