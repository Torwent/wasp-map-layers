import StreamZip from "node-stream-zip"
import { existsSync, mkdirSync } from "node:fs"
import { readdir } from "node:fs/promises"
import sharp, { type OverlayOptions } from "sharp"

const start = performance.now()
const mapPath = "map/"
const chunksUp: string[][] = []
const chunksDown: number[][] = []

async function unzipFile() {
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

for (let zoom = -4; zoom <= 4; zoom++) {
	if (zoom === 2) continue
	for (let plane = 0; plane <= 3; plane++) {
		if (!existsSync(mapPath + zoom + "/" + plane + "/"))
			mkdirSync(mapPath + zoom + "/" + plane + "/", { recursive: true })
	}
}

await unzipFile()
const planes = await readdir(mapPath + "2/")

for (let i = 0; i < planes.length; i++) {
	const files = await readdir(mapPath + "2/" + planes[i] + "/")
	chunksUp.push(files)
}

let lo = { x: 9999, y: 9999 }
let hi = { x: 0, y: 0 }
for (let i = 0; i < chunksUp[0].length; i++) {
	const file = chunksUp[0][i]
	const match = file.match(/(\d+)-(\d+)/)
	if (match == null) continue

	const y: number = parseInt(match[2], 10)
	const x: number = parseInt(match[1], 10)
	hi.y = hi.y < y ? y : hi.y
	hi.x = hi.x < x ? x : hi.x
	lo.y = lo.y > y ? y : lo.y
	lo.x = lo.x > x ? x : lo.x
}

for (let y = 0; y <= hi.y; y++) {
	chunksDown.push([])
	for (let x = 0; x <= hi.x; x++) {
		chunksDown[y].push(x)
	}
}

async function upScale() {
	const startUpscale = performance.now()
	console.log("Starting upscaling for zoom 3 and 4.")

	const positions: sharp.Region[] = [
		{ left: 0, top: 256, width: 256, height: 256 },
		{ left: 256, top: 256, width: 256, height: 256 },
		{ left: 0, top: 0, width: 256, height: 256 },
		{ left: 256, top: 0, width: 256, height: 256 }
	]

	async function createUpScaledTiles(img: sharp.Sharp, z: number, p: number, x: number, y: number) {
		img.resize(512, 512, { kernel: "nearest" })

		const upscaleTasks = []
		for (let i = 0; i <= 3; i++) {
			let currentX: number = x + (i % 2)
			let currentY: number = y + Math.floor(i / 2)

			img.extract(positions[i])

			const fileName = mapPath + z + "/" + planes[p] + "/" + currentX + "-" + currentY + ".png"
			await img.toFile(fileName).catch((error) => console.error(error))

			if (z === 3) {
				const x: number = currentX * 2
				const y: number = currentY * 2
				upscaleTasks.push(createUpScaledTiles(sharp(fileName), 4, p, x, y))
			}
		}

		await Promise.all(upscaleTasks)
	}

	const upScaleTasks = []
	for (let p = 0; p < chunksUp.length; p++) {
		for (let c = 0; c < chunksUp[p].length; c++) {
			const chunkfile = chunksUp[p][c]
			const match = chunkfile.match(/(\d+)-(\d+)/)
			if (match == null) continue

			const x: number = parseInt(match[1], 10) * 2
			const y: number = parseInt(match[2], 10) * 2

			upScaleTasks.push(
				createUpScaledTiles(sharp(mapPath + "2/" + planes[p] + "/" + chunkfile), 3, p, x, y)
			)
		}
	}
	await Promise.all(upScaleTasks)
	console.log(`☝️ Upscalling took ${(performance.now() - startUpscale).toFixed(2)} ms to finish!`)
}

async function downScale() {
	const startDownscale = performance.now()
	console.log("Starting downscaling for zooms 1, 0, -1, -2, -3 and -4.")

	async function createDownScaledTiles(
		imgs: sharp.Sharp[],
		z: number,
		p: number,
		x: number,
		y: number
	) {
		const img = sharp({
			create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
		})

		const positions = ["southwest", "southeast", "northwest", "northeast"]

		let compose: OverlayOptions[] = []
		for (let i = 0; i < imgs.length; i++) {
			imgs[i].resize(128, 128, { kernel: "lanczos3" })
			const buffer = await imgs[i].toBuffer().catch((err) => {})
			if (!buffer) continue
			compose.push({ input: buffer, gravity: positions[i] })
		}

		if (compose.length === 0) return

		img.composite(compose)

		x = Math.round(x / 2)
		y = Math.round(y / 2)

		await img
			.toFile(mapPath + z + "/" + p + "/" + x + "-" + y + ".png")
			.catch((error) => console.error(error))
	}

	for (let z = 1; z >= -4; z--) {
		console.log("📏Downscaling to zoom", z, "/ -4")
		const zDownscaleTasks = []
		for (let p = 0; p < chunksUp.length; p++) {
			for (let y = 0; y < hi.y; y = y + 2) {
				for (let x = 0; x < hi.x; x = x + 2) {
					const current = [
						sharp(mapPath + (z + 1) + "/" + p + "/" + x + "-" + y + ".png"),
						sharp(mapPath + (z + 1) + "/" + p + "/" + (x + 1) + "-" + y + ".png"),
						sharp(mapPath + (z + 1) + "/" + p + "/" + x + "-" + (y + 1) + ".png"),
						sharp(mapPath + (z + 1) + "/" + p + "/" + (x + 1) + "-" + (y + 1) + ".png")
					]

					zDownscaleTasks.push(createDownScaledTiles(current, z, p, x, y))
				}
			}
		}

		await Promise.all(zDownscaleTasks)

		hi.y = Math.ceil(hi.y / 2)
		hi.x = Math.ceil(hi.x / 2)
	}

	console.log(
		`👇 Downscalling took ${(performance.now() - startDownscale).toFixed(2)} ms to finish!`
	)
}

console.log(`└🛠️ Setup took ${(performance.now() - start).toFixed(2)} ms to finish!`)

await Promise.all([downScale(), upScale()])

console.log(`└✅ Done! Took ${(performance.now() - start).toFixed(2)} ms to finish!`)
