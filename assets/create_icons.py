from PIL import Image

base_icon = Image.open("./icon.png")

for size in [16, 32, 48, 128]:
    icon = base_icon.resize((size, size))
    icon.save(f"./icon{size}.png")
