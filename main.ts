import StreamZip from "node-stream-zip"
import { existsSync, mkdirSync } from "node:fs"
import { readdir } from "node:fs/promises"
import sharp from "sharp"

const mapPath = "files/map/"

const unzipFile = async () => {
	const zipFile = "files/map.zip"
	const extractPath = mapPath + "2/"

	if (existsSync(extractPath)) {
		console.log(`Directory "${extractPath}" already exists. Skipping unzip.`)
		return
	}

	mkdirSync(extractPath, { recursive: true })

	const zip = new StreamZip.async({ file: zipFile })
	const count = await zip.extract(null, extractPath)
	console.log(`Finished unzipping ${count} entries.`)
	await zip.close()
}

unzipFile()

const planes = await readdir(mapPath + "2/")

for (let i = -4; i <= 4; i++) {
	if (i === 2) continue
	for (let j = 0; j < planes.length; j++) {
		if (!existsSync(mapPath + i + "/" + planes[j] + "/"))
			mkdirSync(mapPath + i + "/" + planes[j] + "/", { recursive: true })
	}
}

let chunks: string[][] = []

for (let i = 0; i < planes.length; i++) {
	const files = await readdir(mapPath + "2/" + planes[i] + "/")
	chunks.push(files)
}

const positions: sharp.Region[] = [
	{ left: 256, top: 0, width: 256, height: 256 },
	{ left: 256, top: 256, width: 256, height: 256 },
	{ left: 0, top: 256, width: 256, height: 256 },
	{ left: 0, top: 0, width: 256, height: 256 }
]

for (let p = 0; p < chunks.length; p++) {
	console.log("Writting plane " + p)
	for (let c = 0; c < chunks[p].length; c++) {
		const chunkfile = chunks[p][c]
		const match = chunkfile.match(/(\d+)-(\d+)/)
		if (match == null) continue

		const x: number = parseInt(match[1], 10) * 2
		const y: number = parseInt(match[2], 10) * 2

		const current = sharp(mapPath + "2/" + planes[0] + "/" + chunkfile).resize(512, 512, {
			kernel: "nearest"
		})

		for (let i = 0; i <= 3; i++) {
			const mod = i % 2
			const currentX: number = i < 2 ? x + mod : x
			const currentY: number = i >= 2 ? y + mod : y

			await current
				.extract(positions[i])
				.toFile(mapPath + "3/" + planes[p] + "/" + currentX + "-" + currentY + ".png")
				.catch((error) => console.error(error))
		}
	}
}

console.log("Done.")
