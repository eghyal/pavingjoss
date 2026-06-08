import { toCanvas, toJpeg } from 'html-to-image';
import { jsPDF } from 'jspdf';

/**
 * Robust PDF Engine
 * Utilizes html-to-image and jsPDF to ensure exactly 1 A4 page fit
 * and avoid CSS parsing errors (such as oklch) in html2canvas.
 */
export const generatePDF = async (element: HTMLElement, filename: string): Promise<void> => {
  try {
    // Deep clone to ensure we don't accidentally affect the UI during capture
    const clone = element.cloneNode(true) as HTMLElement;
    
    // Attach to body invisibly so dimensions can be read accurately
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.transform = 'none'; // CRITICAL: Reset scale transforms
    
    container.appendChild(clone);
    document.body.appendChild(container);

    // Wait a brief moment for styles to apply and DOM reflow
    await new Promise(resolve => setTimeout(resolve, 300));

    // Capture using html-to-image directly
    const dataUrl = await toJpeg(clone, {
      quality: 0.95,
      pixelRatio: 2.5, // Ultra-high resolution crispness
      backgroundColor: '#ffffff',
      style: {
        transform: 'none',
      },
    });

    // Cleanup immediately
    document.body.removeChild(container);

    // Initialize exactly 1 A4 page
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    // Force strict fit to A4 parameters. 
    pdf.addImage(dataUrl, 'JPEG', 0, 0, pdfWidth, pdfHeight);
    pdf.save(filename);
    
  } catch (error: any) {
    console.error('Print Engine Failure:', error);
    if (document.body.contains(element)) {
      // Ignore cleanup error if it falls through
    }
    throw new Error(`Print generation failed: ${error?.message || String(error)}`);
  }
};
