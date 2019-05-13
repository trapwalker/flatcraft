import asyncio


def do(n=0):
    print(n)
    loop = asyncio.get_event_loop()
    loop.call_later(1, do, n + 1)
    loop.call_later(1, do, n + 1)



if __name__ == '__main__':
    loop = asyncio.get_event_loop()


def main():
    do()
    loop.run_forever()