'use client';

import { useEffect, useMemo, useState } from 'react';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';

interface Props {
  src: string;
  alt: string;
  open: boolean;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, open, onClose }: Props) {
  // Memoizamos el último src válido para que la animación de cierre de YARL
  // no muestre <img src=""> si el blobUrl se revoca durante el unmount.
  const [stableSrc, setStableSrc] = useState(src);
  useEffect(() => {
    if (src) setStableSrc(src);
  }, [src]);

  const slides = useMemo(
    () => [{ src: stableSrc, alt }],
    [stableSrc, alt],
  );

  return (
    <Lightbox
      open={open}
      close={onClose}
      plugins={[Zoom]}
      slides={slides}
      zoom={{
        maxZoomPixelRatio: 5,
        scrollToZoom: true,
        doubleClickMaxStops: 2,
      }}
      carousel={{ finite: true }}
      render={{
        buttonPrev: () => null,
        buttonNext: () => null,
      }}
      controller={{ closeOnBackdropClick: true }}
      styles={{ container: { backgroundColor: 'rgba(0, 0, 0, 0.9)' } }}
    />
  );
}
