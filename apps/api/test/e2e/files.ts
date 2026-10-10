import { strToU8, zipSync } from 'fflate';
import sharp from 'sharp';

// Small real files of each kind, built in memory for the upload tests.

export const pdf = () =>
  Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
  );

/** A minimal Word document: a zip with the parts that identify a DOCX. */
export const docx = () =>
  Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      'word/document.xml': strToU8('<w:document/>'),
    }),
  );

const image = () => sharp({ create: { width: 300, height: 200, channels: 3, background: '#777' } });
export const jpg = () => image().jpeg().toBuffer();
export const png = () => image().png().toBuffer();
export const gif = () => image().gif().toBuffer();

/** Starts like a Windows executable (MZ header), whatever name it is given. */
export const exe = () =>
  Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]), Buffer.alloc(512)]);

/** A plain zip: the container of a DOCX, but not a DOCX. */
export const plainZip = () => Buffer.from(zipSync({ 'readme.txt': strToU8('hello') }));

export const text = () => Buffer.from('Just some text pretending to be a document.');
