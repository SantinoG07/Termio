#!/usr/bin/env python3
"""Transporte USB serie Linux sin dependencias externas. No interpreta registros."""
import errno
import fcntl
import os
import select
import sys
import termios
import tty


def run(port, baud):
    fd = os.open(port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    previous = None
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.ioctl(fd, termios.TIOCEXCL)
        previous = termios.tcgetattr(fd)
        tty.setraw(fd, termios.TCSANOW)
        attrs = termios.tcgetattr(fd)
        speed = getattr(termios, 'B' + str(baud))
        attrs[4] = speed
        attrs[5] = speed
        attrs[2] |= termios.CLOCAL | termios.CREAD
        attrs[2] &= ~termios.CRTSCTS
        termios.tcsetattr(fd, termios.TCSANOW, attrs)
        sys.stderr.write('SERIAL_READY\n')
        sys.stderr.flush()
        inputs = [fd, sys.stdin.fileno()]
        pending = bytearray()
        while True:
            ready, writable, _ = select.select(inputs, [fd] if pending else [], [], 1)
            if sys.stdin.fileno() in ready:
                command = os.read(sys.stdin.fileno(), 4096)
                if not command:
                    inputs.remove(sys.stdin.fileno())
                elif len(pending) + len(command) <= 16384:
                    pending.extend(command)
                else:
                    raise OSError(errno.ENOBUFS, 'command queue full')
            if fd in writable and pending:
                try:
                    written = os.write(fd, pending)
                    del pending[:written]
                except BlockingIOError:
                    pass
            if fd in ready:
                data = os.read(fd, 4096)
                if not data:
                    raise OSError(errno.ENODEV, 'disconnected')
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
    finally:
        if previous is not None:
            try:
                termios.tcsetattr(fd, termios.TCSANOW, previous)
            except OSError:
                pass
        os.close(fd)


if __name__ == '__main__':
    try:
        run(sys.argv[1], int(sys.argv[2]))
    except PermissionError:
        print('SERIAL_PERMISSION_DENIED', file=sys.stderr)
        sys.exit(2)
    except (BlockingIOError, OSError) as error:
        print('SERIAL_PORT_BUSY' if error.errno in (errno.EBUSY, errno.EAGAIN) else 'SERIAL_PORT_ERROR', file=sys.stderr)
        sys.exit(3)
    except (ValueError, IndexError, AttributeError):
        print('SERIAL_CONFIG_ERROR', file=sys.stderr)
        sys.exit(4)
