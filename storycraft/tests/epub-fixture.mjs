/** Minimal EPUB fixture for parser tests. */
import JSZip from 'jszip'

export async function minimalEpub({ title = 'Fixture Book', encryptedChapter = false, encryptedUri, bodyText = 'Hello EPUB', chapters = 1 } = {}) {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)
  const manifest = []
  const spine = []
  for (let index = 1; index <= chapters; index += 1) {
    manifest.push(`<item id="c${index}" href="chapter${index}.xhtml" media-type="application/xhtml+xml"/>`)
    spine.push(`<itemref idref="c${index}"/>`)
    zip.file(`OEBPS/chapter${index}.xhtml`, `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter ${index}</h1><p>${bodyText}</p></body></html>`)
  }
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata>
  <manifest>${manifest.join('')}</manifest>
  <spine>${spine.join('')}</spine>
</package>`)
  if (encryptedChapter || encryptedUri !== undefined) {
    zip.file('META-INF/encryption.xml', `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData><enc:CipherData><enc:CipherReference URI="${encryptedChapter ? 'OEBPS/chapter1.xhtml' : encryptedUri}"/></enc:CipherData></enc:EncryptedData>
</encryption>`)
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}
