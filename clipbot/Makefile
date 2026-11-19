.PHONY: install lint fmt test check doctor

install:
	uv sync

lint:
	uv run ruff check src tests
	uv run ruff format --check src tests

fmt:
	uv run ruff format src tests
	uv run ruff check --fix src tests

test:
	uv run pytest

check: lint test

doctor:
	uv run clipbot doctor
