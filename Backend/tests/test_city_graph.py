"""Unit tests for the street graph and A* routing, on hand-written cell layouts."""

import networkx as nx
import pytest

from traffic_base.city_graph import (
    DIRECTION_VECTORS,
    build_street_graph,
    infer_light_directions,
    is_legal_move,
    shortest_route,
)

RIGHT, LEFT = DIRECTION_VECTORS["Right"], DIRECTION_VECTORS["Left"]
UP, DOWN = DIRECTION_VECTORS["Up"], DIRECTION_VECTORS["Down"]

# Two lanes going right, three cells long: y=1 on top of y=0.
TWO_LANES = {(x, y): RIGHT for x in range(3) for y in range(2)}


def test_driving_forward_is_legal() -> None:
    assert is_legal_move(RIGHT, RIGHT, RIGHT)


def test_driving_backwards_is_illegal() -> None:
    assert not is_legal_move(LEFT, RIGHT, RIGHT)


def test_sliding_into_the_opposite_lane_is_illegal() -> None:
    assert not is_legal_move(UP, RIGHT, LEFT)


def test_crossing_an_intersection_that_points_across_your_path_is_legal() -> None:
    # Driving down a column through a row of '<' cells, then into the next 'v'.
    assert is_legal_move(DOWN, DOWN, LEFT)
    assert is_legal_move(DOWN, LEFT, DOWN)


def test_a_light_fed_by_another_light_takes_the_road_direction() -> None:
    lights = infer_light_directions({(0, 0): RIGHT}, [(2, 0), (1, 0)])
    assert lights == {(2, 0): RIGHT, (1, 0): RIGHT}


def test_a_light_no_road_feeds_is_rejected() -> None:
    with pytest.raises(ValueError, match=r"\(5, 5\)"):
        infer_light_directions({(0, 0): RIGHT}, [(5, 5)])


def test_diagonal_past_a_building_corner_has_no_edge() -> None:
    # (1, 0) is a building, so (0, 0) -> (1, 1) would clip its corner.
    graph = build_street_graph({(0, 0): RIGHT, (0, 1): RIGHT, (1, 1): RIGHT}, set())
    assert not graph.has_edge((0, 0), (1, 1))
    assert graph.has_edge((0, 0), (0, 1))


def test_destinations_are_entered_straight_and_never_left() -> None:
    graph = build_street_graph({(0, 0): RIGHT, (0, 1): RIGHT}, {(1, 0)})
    assert graph.has_edge((0, 0), (1, 0))
    assert not graph.has_edge((0, 1), (1, 0))  # diagonal entry
    assert graph.out_degree((1, 0)) == 0


def test_route_goes_straight_when_the_lane_is_clear() -> None:
    graph = build_street_graph(TWO_LANES, set())
    assert shortest_route(graph, (0, 0), (2, 0)) == [(1, 0), (2, 0)]


def test_route_with_avoid_changes_lane_around_the_blocked_cell() -> None:
    graph = build_street_graph(TWO_LANES, set())
    route = shortest_route(graph, (0, 0), (2, 0), avoid={(1, 0)})
    assert route[-1] == (2, 0)
    assert (1, 0) not in route


def test_route_is_empty_when_the_goal_is_behind_you() -> None:
    graph = build_street_graph(TWO_LANES, set())
    assert shortest_route(graph, (2, 0), (0, 0)) == []


def test_route_from_a_cell_outside_the_graph_is_an_error() -> None:
    graph = build_street_graph(TWO_LANES, set())
    with pytest.raises(nx.NodeNotFound):
        shortest_route(graph, (9, 9), (2, 0))
