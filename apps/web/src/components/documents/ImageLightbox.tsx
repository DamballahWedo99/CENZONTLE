'use client';

import { useMemo, useState } from 'react';
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
  // El ajuste va DURANTE el render (no en un effect): React descarta el
  // output y re-renderiza con el src nuevo antes de pintar, así que el
  // Lightbox nunca llega a mostrar un frame con el src anterior.
  const [stableSrc, setStableSrc] = useState(src);
  if (src && src !== stableSrc) setStableSrc(src);

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
